import { fork, type ChildProcess } from 'node:child_process'
import type { AddressInfo } from 'node:net'
import { createApplication } from '../application.ts'
import { LibraryHttpModule } from '../library-http/library-http.module.ts'
import { StudyHttpModule } from '../study-http/study.module.ts'
import type { RuntimeConfiguration } from '../runtime/runtime-configuration.ts'

/** Own one private Nest API and one public stock Vite process; a crash fails the entire generation. */
export class DevelopmentApplication {
  readonly backend: ReturnType<typeof createApplication>
  readonly failed: Promise<Error>
  private reportFailure!: (error: Error) => void
  private child: ChildProcess | undefined
  private exited: Promise<void> | undefined
  private starting: Promise<void> | undefined
  private closing: Promise<void> | undefined
  private cancelReady: (() => void) | undefined

  constructor(
    private readonly configuration: RuntimeConfiguration,
    private readonly root = process.cwd(),
  ) {
    this.failed = new Promise((resolve) => {
      this.reportFailure = resolve
    })
    this.backend = createApplication(configuration, [LibraryHttpModule, StudyHttpModule])
  }

  /** Announce readiness only after Nest listens and the public child has completed stock listen.
   * @throws {Error} If either listener fails, the child exits, or readiness times out; acquired roots are closed.
   */
  start(): Promise<void> {
    this.starting ??= this.initialize().catch(async (error: unknown) => {
      await this.close()
      throw error
    })
    return this.starting
  }

  private async initialize(): Promise<void> {
    const backend = await this.backend
    if (this.closing) {
      throw new Error('Development application is closing.')
    }
    await backend.init()
    await backend.listen(0, '127.0.0.1')
    if (this.closing) {
      throw new Error('Development application is closing.')
    }
    const address = backend.getHttpServer().address() as AddressInfo
    const environment: NodeJS.ProcessEnv = { PATH: process.env.PATH, NODE_ENV: 'development' }
    for (const [key, value] of Object.entries(process.env)) {
      if (key.startsWith('VITE_')) {
        environment[key] = value
      }
    }
    const child = fork(
      new URL('./development-frontend.js', import.meta.url),
      [
        this.configuration.origin.origin,
        this.configuration.host,
        String(this.configuration.port),
        `http://127.0.0.1:${address.port}`,
      ],
      {
        cwd: this.root,
        env: environment,
        detached: true,
        execArgv: [],
        stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
      },
    )
    this.child = child
    this.exited = new Promise((resolve) => {
      child.once('exit', () => {
        resolve()
        if (!this.closing) {
          this.reportFailure(new Error('Development frontend exited unexpectedly.'))
          void this.close().catch(() => {
            process.exitCode = 1
          })
        }
      })
      child.once('error', () => {
        resolve()
      })
    })
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => finish(new Error('Development frontend readiness timed out.')),
        15000,
      )

      const onExit = () => finish(new Error('Development frontend exited before readiness.'))

      const onMessage = (message: unknown) => {
        if (message && typeof message === 'object' && 'event' in message) {
          if (message.event === 'ready') {
            finish()
          }
          if (message.event === 'failed') {
            finish(new Error('Development frontend startup failed.'))
          }
        }
      }

      const finish = (error?: Error) => {
        clearTimeout(timer)
        child.off('message', onMessage)
        child.off('exit', onExit)
        child.off('error', onExit)
        this.cancelReady = undefined
        if (error) {
          reject(error)
        } else {
          resolve()
        }
      }

      this.cancelReady = () => finish(new Error('Development application is closing.'))
      child.on('message', onMessage)
      child.once('exit', onExit)
      child.once('error', onExit)
    })
  }

  /** Stop public admission, drain Nest-owned work before SQLite roots, then terminate and join the child group. */
  close(): Promise<void> {
    this.closing ??= this.dispose()
    return this.closing
  }

  private async dispose(): Promise<void> {
    this.cancelReady?.()
    const child = this.child
    if (child?.connected) {
      const stopped = await new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => done(false), 1000)

        function done(stopped: boolean) {
          clearTimeout(timer)
          child!.off('message', onMessage)
          resolve(stopped)
        }

        function onMessage(message: unknown) {
          if (
            message &&
            typeof message === 'object' &&
            'event' in message &&
            message.event === 'stopped'
          ) {
            done(true)
          }
        }

        child.on('message', onMessage)
        child.send({ command: 'stop' }, (error) => {
          if (error) {
            done(false)
          }
        })
      })
      if (!stopped) {
        // An unresponsive frontend must lose its public listener before backend drainage begins.
        await this.terminateFrontend()
      }
    }
    try {
      const backend = await this.backend.catch(() => undefined)
      await backend?.close()
    } finally {
      await this.terminateFrontend()
    }
  }

  /** Bound stock/partial Vite disposal and join the process even when its factory never returned. */
  private async terminateFrontend(): Promise<void> {
    const child = this.child
    if (child?.pid) {
      const signalGroup = (signal: NodeJS.Signals) => {
        try {
          process.kill(-child.pid!, signal)
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ESRCH') {
            throw error
          }
        }
      }

      signalGroup('SIGTERM')
      const timer = setTimeout(() => signalGroup('SIGKILL'), 2000)
      try {
        await this.exited
      } finally {
        clearTimeout(timer)
        signalGroup('SIGKILL')
      }
    }
  }
}
