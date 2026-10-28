import 'reflect-metadata'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import type { Server as NetServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setImmediate as nextTurn } from 'node:timers/promises'
import { test } from 'node:test'
import type { ViteDevServer } from 'vite'
import { ApplicationRuntime } from '../../src/server/runtime/application-runtime.ts'
import { createProductionApplication } from '../../src/server/production-application.ts'
import { runtimeConfiguration } from '../../src/server/runtime/runtime-configuration.ts'

type EnvironmentEvent = { generation: number; name: string; method: string; previous: boolean }

type ActivationFixture = {
  next: number
  events: EnvironmentEvent[]
  graphs: ViteDevServer[]
  transports: NetServer[]
  ports: number[]
  fail: string | undefined
  error: Error
  gate?: Promise<void>
  entered?: () => void
}

/** Bound public lifecycle observations while letting finally release all owned resources on red. */
async function within<T>(pending: Promise<T>, description: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      pending,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${description} timed out`)), 5000)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

/** Retain the socket immediately, including when its opening handshake fails. */
function connection(port: number) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/`, 'vite-hmr')
  const closed = new Promise<void>((resolve) =>
    socket.addEventListener('close', () => resolve(), { once: true }),
  )
  const opened = new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve(), { once: true })
    socket.addEventListener('error', () => reject(new Error('HMR connection failed')), {
      once: true,
    })
  })
  return { socket, opened, closed }
}

for (const mode of ['handoff', 'failure', 'pending', 'parallel-failure']) {
  test(
    `environment ${mode} reuses its endpoint in init-close-listen order and drains Nest`,
    { timeout: 20000 },
    async () => {
      const directory = mkdtempSync(join(tmpdir(), 'study-vite-activation-'))
      const previousDirectory = process.cwd()
      const globals = globalThis as unknown as Record<string, ActivationFixture>
      const state: ActivationFixture = {
        next: 0,
        events: [],
        graphs: [],
        transports: [],
        ports: [],
        fail: undefined,
        error: new Error('injected activation failure'),
      }
      globals.__studyActivation = state
      writeFileSync(join(directory, 'index.html'), '<title>Activation fixture</title>')
      const configPath = join(directory, 'vite.config.mts')
      writeFileSync(
        configPath,
        `
      import { createServer } from 'node:net'
      export default { plugins: [{ name: 'public-environment-endpoint',
        configureServer(server) { globalThis.__studyActivation.graphs.push(server) },
        configResolved(config) {
          const state = globalThis.__studyActivation
          const generation = state.next++
          for (const options of Object.values(config.environments)) {
            const create = options.dev.createEnvironment
            options.dev.createEnvironment = async (...args) => {
              const environment = await create(...args)
              const init = environment.init.bind(environment)
              const listen = environment.listen.bind(environment)
              const close = environment.close.bind(environment)
              const transport = environment.name === 'ssr' ? createServer() : undefined
              if (transport) { state.transports.push(transport) }
              environment.init = async options => {
                state.events.push({ generation, name: environment.name, method: 'init', previous: !!options.previousInstance })
                environment.fixturePort = options.previousInstance?.fixturePort ?? 0
                return init(options)
              }
              environment.listen = async server => {
                state.events.push({ generation, name: environment.name, method: 'listen', previous: false })
                if (generation > 0 && transport && state.gate) { state.entered(); await state.gate }
                if (generation > 0 && state.fail === environment.name) { throw state.error }
                if (transport) {
                  await new Promise((resolve, reject) => {
                    transport.once('error', reject)
                    transport.listen(environment.fixturePort, '127.0.0.1', () => { transport.off('error', reject); resolve() })
                  })
                  environment.fixturePort = transport.address().port
                  state.ports.push(environment.fixturePort)
                }
                return listen(server)
              }
              environment.close = async () => {
                state.events.push({ generation, name: environment.name, method: 'close', previous: false })
                try { await close() } finally {
                  if (transport) { await new Promise(resolve => transport.close(() => resolve())) }
                }
              }
              return environment
            }
          }
        },
      }] }
    `,
        { mode: 0o600 },
      )
      const configuration = runtimeConfiguration({
        STUDY_DB_PATH: join(directory, 'library.sqlite3'),
      })
      configuration.port = 0
      let app: Awaited<ReturnType<typeof createProductionApplication>> | undefined
      const sockets: ReturnType<typeof connection>[] = []
      let restarting: Promise<void> | undefined
      let closing: Promise<void> | undefined

      let release = () => {}

      try {
        process.chdir(directory)
        app = await createProductionApplication(configuration)
        await app.listen(0, '127.0.0.1')
        const runtime = app.get(ApplicationRuntime)
        const http = app.getHttpServer() as import('node:http').Server
        const address = http.address()
        assert.ok(address && typeof address !== 'string')
        const initial = state.graphs[0]!
        sockets.push(connection(address.port))
        await within(sockets[0]!.opened, 'Initial HMR')
        if (mode === 'failure') {
          state.fail = 'ssr'
        }
        if (mode === 'parallel-failure') {
          state.fail = 'client'
        }
        let entered: Promise<void> | undefined
        if (mode === 'pending' || mode === 'parallel-failure') {
          entered = new Promise<void>((resolve) => {
            state.entered = resolve
          })
          state.gate = new Promise<void>((resolve) => {
            release = resolve
          })
        }
        restarting = initial.restart()
        // Observe a rejection immediately, even when another activation remains deliberately pending.
        void restarting.catch(() => {})
        if (entered) {
          await within(entered, 'Activation acknowledgement')
          if (mode === 'pending') {
            sockets.push(connection(address.port))
            await within(sockets[1]!.opened, 'Replacement HMR during activation')
            let closed = false
            closing = app.close().then(() => {
              closed = true
            })
            await nextTurn()
            await nextTurn()
            assert.equal(closed, false, 'Shutdown must join public environment activation')
            runtime.sharedLibrary.quizStore().nextHousekeepingAt()
            assert.equal(sockets[1]!.socket.readyState, WebSocket.OPEN)
          } else {
            let settled = false
            void restarting.then(
              () => {
                settled = true
              },
              () => {
                settled = true
              },
            )
            await nextTurn()
            await nextTurn()
            assert.equal(
              settled,
              false,
              'Activation rejection must drain parallel environment work',
            )
          }
          release()
        }
        if (state.fail) {
          await assert.rejects(within(restarting, 'Activation failure'), (error) => {
            assert.equal(error, state.error)
            return true
          })
          await within(sockets[0]!.closed, 'Previous HMR closure before activation failure')
          assert.deepEqual(state.graphs[0]!.watcher.getWatched(), {}, 'The predecessor is closed')
          const failed = state.graphs.at(-1)!
          assert.ok(Object.keys(failed.watcher.getWatched()).length > 0, 'Recovery remains watched')
          runtime.sharedLibrary.quizStore().nextHousekeepingAt()
          if (mode === 'parallel-failure') {
            assert.ok(state.transports.some((transport) => transport.listening))
            sockets.push(connection(address.port))
            await within(sockets.at(-1)!.opened, 'HMR in the failed selected graph')
            closing = app.close()
          } else {
            // Match Vite: a real file edit can recover the selected, partially activated graph.
            state.fail = undefined
            state.gate = undefined

            const changed = new Promise<void>((resolve) => {
              const observe = (path: string) => {
                if (path === configPath) {
                  failed.watcher.off('change', observe)
                  resolve()
                }
              }

              failed.watcher.on('change', observe)
            })

            writeFileSync(
              configPath,
              readFileSync(configPath, 'utf8') + '\n// Recover activation.\n',
            )
            await within(changed, 'Failed selection config change')
            await nextTurn()
            await within(failed.restart(), 'Config recovery after activation failure')
          }
        } else {
          await within(restarting, 'Environment handoff')
        }
        for (const name of ['client', 'ssr']) {
          const init = state.events.findIndex(
            (event) => event.generation === 1 && event.name === name && event.method === 'init',
          )
          const oldClose = state.events.findIndex(
            (event) => event.generation === 0 && event.name === name && event.method === 'close',
          )
          const listen = state.events.findIndex(
            (event) => event.generation === 1 && event.name === name && event.method === 'listen',
          )
          assert.ok(
            init >= 0 && init < oldClose && oldClose < listen,
            `${name}: new init -> previous close -> new listen`,
          )
          assert.equal(state.events[init]!.previous, true)
        }
        assert.ok(
          state.ports.length >= 2,
          'The replacement or successful retry really binds the endpoint',
        )
        assert.ok(
          state.ports.every((port) => port === state.ports[0]),
          'Every activation reuses the same ephemeral endpoint',
        )
        if (!closing) {
          sockets.push(connection(address.port))
          await within(sockets.at(-1)!.opened, 'HMR after handoff/retry')
          closing = app.close()
        }
        await within(closing, 'Nest shutdown')
        for (const socket of sockets) {
          await within(socket.closed, 'HMR shutdown')
        }
        for (const graph of state.graphs) {
          assert.deepEqual(graph.watcher.getWatched(), {})
        }
        assert.ok(state.transports.every((transport) => !transport.listening))
        assert.equal(
          process.getActiveResourcesInfo().filter((name) => name === 'FSEventWrap').length,
          0,
        )
        assert.throws(
          () => runtime.sharedLibrary.quizStore().nextHousekeepingAt(),
          /closed|not open/,
        )
        assert.throws(() => runtime.authentication.legacyOwnerId('closed'), /closed|not open/)
      } finally {
        release()
        for (const socket of sockets) {
          socket.socket.close()
        }
        await restarting?.catch(() => {})
        for (const graph of state.graphs) {
          await graph.ws.close().catch(() => {})
          await graph.close()
          await graph.watcher.close()
        }
        for (const transport of state.transports) {
          await new Promise<void>((resolve) => transport.close(() => resolve()))
        }
        await closing
        await app?.close()
        delete globals.__studyActivation
        process.chdir(previousDirectory)
        rmSync(directory, { recursive: true, force: true })
      }
    },
  )
}
