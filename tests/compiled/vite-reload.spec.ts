import 'reflect-metadata'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setImmediate as nextTurn } from 'node:timers/promises'
import { test } from 'node:test'
import type { ViteDevServer } from 'vite'
import { ApplicationRuntime } from '../../src/server/application-runtime.ts'
import { createProductionApplication } from '../../src/server/production-application.ts'
import { runtimeConfiguration } from '../../src/server/runtime-configuration.ts'

type ReloadFixture = {
  graphs: ViteDevServer[]
  failure: string
  revision: number
  gate?: Promise<void>
  entered?: () => void
}

/** Bound observation without using an extra signal or relying on fatal process exit for cleanup. */
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

/** Establish an actual upgraded HMR connection and observe its close event before initiating shutdown. */
async function hmr(port: number) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/`, 'vite-hmr')
  const closed = new Promise<void>((resolve) =>
    socket.addEventListener('close', () => resolve(), { once: true }),
  )
  try {
    await within(
      new Promise<void>((resolve, reject) => {
        socket.addEventListener('open', () => resolve(), { once: true })
        socket.addEventListener('error', () => reject(new Error('HMR connection failed')), {
          once: true,
        })
      }),
      'HMR connection',
    )
    return { socket, closed }
  } catch (error) {
    socket.close()
    await within(closed, 'Failed connection cleanup')
    throw error
  }
}

for (const phase of ['buildStart', 'configureServer', 'options', 'factory']) {
  test(
    `failed ${phase} replacement retains live HMR ownership and drains every graph`,
    { timeout: 20000 },
    async () => {
      const nativeBaseline = process
        .getActiveResourcesInfo()
        .filter((name) => name === 'FSEventWrap').length
      const directory = mkdtempSync(join(tmpdir(), 'study-vite-reload-'))
      const previousDirectory = process.cwd()
      const globals = globalThis as unknown as Record<string, ReloadFixture>
      const state: ReloadFixture = { graphs: [], failure: '', revision: 0 }
      globals.__studyReload = state
      const configPath = join(directory, 'vite.config.mts')
      writeFileSync(join(directory, 'index.html'), '<title>Fixture</title>')
      writeFileSync(
        configPath,
        `
      const state = globalThis.__studyReload
      const revision = state.revision
      export default { define: { __RELOAD_REVISION__: 'initial' }, plugins: [{
        name: 'first-user-reload-hook', enforce: 'pre',
        transformIndexHtml(html) { return html + '<!-- revision-' + revision + ' -->' },
        configResolved(config) {
          if (state.failure === 'factory') {
            for (const options of Object.values(config.environments)) {
              options.dev.createEnvironment = () => { throw new Error('injected reload factory') }
            }
          }
        },
        configureServer: { order: 'pre', async handler(server) {
          state.graphs.push(server)
          await new Promise(resolve => server.watcher.once('ready', resolve))
          if (state.gate) { state.entered(); await state.gate }
          if (state.failure === 'configureServer') { throw new Error('injected reload configureServer') }
        } },
        options: { order: 'pre', handler() {
          if (state.failure === 'options') { throw new Error('injected reload options') }
        } },
        buildStart: { order: 'pre', handler() {
          if (state.failure === 'buildStart') { throw new Error('injected reload buildStart') }
        } },
      }] }
    `,
        { mode: 0o600 },
      )
      const configuration = runtimeConfiguration({
        STUDY_DB_PATH: join(directory, 'library.sqlite3'),
      })
      configuration.port = 0
      let app: Awaited<ReturnType<typeof createProductionApplication>> | undefined
      const connections: Awaited<ReturnType<typeof hmr>>[] = []
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
        const origin = `http://127.0.0.1:${address.port}`
        configuration.origin.port = String(address.port)
        const initial = state.graphs[0]!
        connections.push(await hmr(address.port))
        state.failure = phase
        state.revision = 1
        if (phase === 'buildStart') {
          const changed = new Promise<void>((resolve) => {
            const observe = (path: string) => {
              if (path === configPath) {
                initial.watcher.off('change', observe)
                resolve()
              }
            }

            initial.watcher.on('change', observe)
          })

          writeFileSync(
            configPath,
            readFileSync(configPath, 'utf8') + '\n// Trigger real config reload.\n',
          )
          await within(changed, 'Config change observation')
          await nextTurn()
        }
        await within(initial.restart(), 'Rejected replacement')
        assert.equal(
          connections[0]!.socket.readyState,
          WebSocket.OPEN,
          'A failed replacement keeps the live graph serving',
        )
        const response = await fetch(`${origin}/api/health`)
        assert.deepEqual(await response.json(), { status: 'ok' })
        assert.match(
          await (await fetch(origin)).text(),
          /revision-0/,
          'Failed replacement keeps live middleware',
        )
        for (const partial of state.graphs.slice(1)) {
          assert.equal((partial.watcher as unknown as { closed: boolean }).closed, true)
          assert.ok(
            Object.values(partial.watcher.getWatched()).every((children) => children.length === 0),
          )
        }
        // Retry successfully, then fail again: ownership must follow the completed handoff.
        state.failure = ''
        await within(initial.restart(), 'Successful retry')
        await within(connections[0]!.closed, 'Old HMR closure after successful handoff')
        connections.push(await hmr(address.port))
        const live = state.graphs.at(-1)!
        assert.match(
          await (await fetch(origin)).text(),
          /revision-1/,
          'Successful handoff changes middleware',
        )
        state.failure = phase
        state.revision = 2
        if (phase === 'configureServer') {
          const entered = new Promise<void>((resolve) => {
            state.entered = resolve
          })
          state.gate = new Promise<void>((resolve) => {
            release = resolve
          })
          const replacing = live.restart()
          await within(entered, 'Replacement initialization acknowledgement')
          let closed = false
          closing = app.close().then(() => {
            closed = true
          })
          await nextTurn()
          await nextTurn()
          assert.equal(closed, false, 'Shutdown drains an in-progress replacement')
          assert.equal(connections[1]!.socket.readyState, WebSocket.OPEN)
          runtime.sharedLibrary.quizStore().nextHousekeepingAt()
          release()
          await within(replacing, 'Rejected replacement during shutdown')
        } else {
          await within(live.restart(), 'Second rejected replacement')
          closing = app.close()
        }
        await within(closing, 'Nest shutdown after rejected replacement')
        await within(connections[1]!.closed, 'Live HMR closure on shutdown')
        for (const graph of state.graphs) {
          assert.equal((graph.watcher as unknown as { closed: boolean }).closed, true)
          // Delayed Chokidar stat failures may leave empty directory metadata after close.
          // Native handle disposal and the controlled stat-tail regression verify resource closure.
          assert.ok(
            Object.values(graph.watcher.getWatched()).every((children) => children.length === 0),
          )
        }
        await nextTurn()
        await nextTurn()
        assert.equal(
          process.getActiveResourcesInfo().filter((name) => name === 'FSEventWrap').length,
          nativeBaseline,
        )
        assert.throws(
          () => runtime.sharedLibrary.quizStore().nextHousekeepingAt(),
          /closed|not open/,
        )
        assert.throws(() => runtime.authentication.legacyOwnerId('closed'), /closed|not open/)
      } finally {
        release()
        // Release every externally captured graph/socket even when the bounded red assertion fails.
        for (const connection of connections) {
          connection.socket.close()
        }
        for (const graph of state.graphs) {
          await graph.ws.close().catch(() => {})
          await graph.close()
          await graph.watcher.close()
        }
        await closing
        await app?.close()
        delete globals.__studyReload
        process.chdir(previousDirectory)
        rmSync(directory, { recursive: true, force: true })
      }
    },
  )
}
