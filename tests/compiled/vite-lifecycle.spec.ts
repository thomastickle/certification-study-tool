import 'reflect-metadata'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setImmediate as nextTurn } from 'node:timers/promises'
import { test } from 'node:test'
import type { ViteDevServer, FSWatcher } from 'vite'
import { NestFactory } from '@nestjs/core'
import { ApplicationRuntime } from '../../src/server/application-runtime.ts'
import { startLegacyTransport } from '../../src/server/legacy-transport.ts'
import { runtimeConfiguration } from '../../src/server/runtime-configuration.ts'
import { RuntimeModule } from '../../src/server/runtime.module.ts'

type CapturedVite = { server?: ViteDevServer; watcher?: FSWatcher & { closed: boolean } }

for (const phase of ['configureServer', 'buildStart', 'options'] as const) {
  test(`contained ${phase} failure releases allocated Vite resources and SQLite roots`, async () => {
    const directory = mkdtempSync(join(tmpdir(), 'study-vite-partial-'))
    const previousDirectory = process.cwd()
    const captures = globalThis as unknown as Record<string, CapturedVite>
    const key = '__studyPartialVite'
    captures[key] = {}
    const watcherCount = process
      .getActiveResourcesInfo()
      .filter((name) => name === 'FSEventWrap').length
    writeFileSync(
      join(directory, 'vite.config.mts'),
      `
      const capture = globalThis.${key}
      export default { plugins: [{
        name: 'first-user-pre-hook', enforce: 'pre',
        configResolved(config) {
          for (const options of Object.values(config.environments)) {
            const create = options.dev.createEnvironment
            options.dev.createEnvironment = async (...args) => {
              const environment = await create(...args)
              const init = environment.init.bind(environment)
              environment.init = async (options) => {
                capture.watcher = options.watcher
                await new Promise(resolve => options.watcher.once('ready', resolve))
                return init(options)
              }
              return environment
            }
          }
        },
        configureServer: { order: 'pre', handler(server) {
          capture.server = server
          ${phase === 'configureServer' ? "throw new Error('injected configureServer failure')" : ''}
        } },
        ${phase === 'buildStart' ? "buildStart: { order: 'pre', handler() { throw new Error('injected buildStart failure') } }," : ''}
        ${phase === 'options' ? "options: { order: 'pre', handler() { throw new Error('injected options failure') } }," : ''}
      }] }
    `,
      { mode: 0o600 },
    )
    const configuration = runtimeConfiguration({
      STUDY_DB_PATH: join(directory, 'library.sqlite3'),
    })
    configuration.port = 0
    const app = await NestFactory.createApplicationContext(RuntimeModule.register(configuration), {
      logger: false,
      abortOnError: false,
    })
    const runtime = app.get(ApplicationRuntime)
    try {
      process.chdir(directory)
      await assert.rejects(
        startLegacyTransport(runtime, configuration),
        new RegExp(`injected ${phase} failure`),
      )
      await app.close()
      const { watcher } = captures[key]!
      assert.ok(watcher, 'The failure occurs after actual watcher allocation and readiness')
      assert.equal(watcher.closed, true)
      assert.deepEqual(watcher.getWatched(), {})
      // fs.watch closes its libuv handle in the close phase after the promise settles.
      await nextTurn()
      await nextTurn()
      assert.equal(
        process.getActiveResourcesInfo().filter((name) => name === 'FSEventWrap').length,
        watcherCount,
      )
      assert.throws(() => runtime.sharedLibrary.quizStore().nextHousekeepingAt(), /closed|not open/)
      assert.throws(() => runtime.authentication.legacyOwnerId('closed'), /closed|not open/)
    } finally {
      // Even a red regression must explicitly release captured external resources.
      await captures[key]?.server?.close()
      await captures[key]?.watcher?.close()
      await app.close()
      delete captures[key]
      process.chdir(previousDirectory)
      rmSync(directory, { recursive: true, force: true })
    }
  })
}

test('rejected environment factories release the watcher even before init can return a server', async () => {
  const fs = await import('node:fs')
  const { syncBuiltinESMExports } = await import('node:module')
  const { mock } = await import('node:test')
  const directory = mkdtempSync(join(tmpdir(), 'study-vite-factory-'))
  const previousDirectory = process.cwd()
  const native = new Set<ReturnType<typeof fs.watch>>()
  const closed = new Set<ReturnType<typeof fs.watch>>()
  let ready!: () => void
  const captures = globalThis as unknown as Record<string, Promise<void>>
  captures.__studyNativeWatchReady = new Promise<void>((resolve) => {
    ready = resolve
  })
  const originalWatch = fs.default.watch
  const watch = mock.method(fs.default, 'watch', (...args: Parameters<typeof originalWatch>) => {
    const watcher = originalWatch(...args)
    native.add(watcher)
    watcher.once('close', () => closed.add(watcher))
    ready()
    return watcher
  })
  syncBuiltinESMExports()
  writeFileSync(
    join(directory, 'vite.config.mts'),
    `
    export default { plugins: [{ name: 'reject-every-environment', configResolved(config) {
      for (const options of Object.values(config.environments)) {
        options.dev.createEnvironment = async () => {
          await globalThis.__studyNativeWatchReady
          throw new Error('injected environment factory failure')
        }
      }
    } }] }
  `,
    { mode: 0o600 },
  )
  const configuration = runtimeConfiguration({ STUDY_DB_PATH: join(directory, 'library.sqlite3') })
  const app = await NestFactory.createApplicationContext(RuntimeModule.register(configuration), {
    logger: false,
    abortOnError: false,
  })
  const runtime = app.get(ApplicationRuntime)
  const before = process.getActiveResourcesInfo().filter((name) => name === 'FSEventWrap').length
  try {
    process.chdir(directory)
    await assert.rejects(
      startLegacyTransport(runtime, configuration),
      /injected environment factory failure/,
    )
    await app.close()
    assert.ok(native.size > 0, 'The factories reject only after actual native watcher allocation')
    assert.equal(closed.size, native.size)
    assert.equal(
      process.getActiveResourcesInfo().filter((name) => name === 'FSEventWrap').length,
      before,
    )
    assert.throws(() => runtime.sharedLibrary.quizStore().nextHousekeepingAt(), /closed|not open/)
    assert.throws(() => runtime.authentication.legacyOwnerId('closed'), /closed|not open/)
  } finally {
    ready()
    for (const watcher of native) {
      watcher.close()
    }
    watch.mock.restore()
    syncBuiltinESMExports()
    delete captures.__studyNativeWatchReady
    await app.close()
    process.chdir(previousDirectory)
    rmSync(directory, { recursive: true, force: true })
  }
})

test('public-file failure removes HMR listeners before environment/watch ownership is exposed', async () => {
  const { createServer } = await import('node:http')
  const { DevelopmentVite } = await import('../../src/server/development-vite.ts')
  const directory = mkdtempSync(join(tmpdir(), 'study-vite-public-files-'))
  const previousDirectory = process.cwd()
  writeFileSync(join(directory, 'not-directory'), 'fixture')
  writeFileSync(
    join(directory, 'vite.config.mts'),
    "export default { publicDir: 'not-directory' }\n",
    { mode: 0o600 },
  )
  const server = createServer()
  const development = new DevelopmentVite()
  const before = process.getActiveResourcesInfo().filter((name) => name === 'FSEventWrap').length
  try {
    process.chdir(directory)
    await assert.rejects(development.initialize(server), /ENOTDIR/)
    await development.close()
    assert.equal(server.listenerCount('upgrade'), 0)
    assert.equal(
      process.getActiveResourcesInfo().filter((name) => name === 'FSEventWrap').length,
      before,
    )
  } finally {
    await development.close()
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    process.chdir(previousDirectory)
    rmSync(directory, { recursive: true, force: true })
  }
})

test('successful Vite initialization retains config-file watching and restart outside the web root', async () => {
  const { createServer } = await import('node:http')
  const { mkdirSync } = await import('node:fs')
  const { DevelopmentVite } = await import('../../src/server/development-vite.ts')
  const directory = mkdtempSync(join(tmpdir(), 'study-vite-config-watch-'))
  const previousDirectory = process.cwd()
  mkdirSync(join(directory, 'web'))
  writeFileSync(join(directory, 'web/index.html'), '<title>Fixture</title>')
  writeFileSync(
    join(directory, 'vite.config.mts'),
    `
    export default { root: 'web', define: { __TEST_WATCH__: 'first' }, plugins: [{ name: 'wait-for-real-watches',
      async configureServer(server) { await new Promise(resolve => server.watcher.once('ready', resolve)) }
    }] }
  `,
    { mode: 0o600 },
  )
  const server = createServer()
  const development = new DevelopmentVite()
  try {
    process.chdir(directory)
    const vite = await development.initialize(server)
    assert.ok(vite.watcher.getWatched()[directory]?.includes('vite.config.mts'))
    assert.ok(Object.hasOwn(vite.watcher.getWatched(), join(directory, 'web')))
    const configPath = join(directory, 'vite.config.mts')

    const changed = new Promise<void>((resolve) => {
      const observe = (path: string) => {
        if (path === configPath) {
          vite.watcher.off('change', observe)
          resolve()
        }
      }

      vite.watcher.on('change', observe)
    })

    writeFileSync(
      configPath,
      readFileSync(configPath, 'utf8').replace(
        "__TEST_WATCH__: 'first'",
        "__TEST_WATCH__: 'second'",
      ),
    )
    await changed
    // Let Vite's earlier change listener start its reload, then join it through the public API.
    await nextTurn()
    await vite.restart()
    assert.equal(vite.config.define?.__TEST_WATCH__, 'second')
    await development.close()
    assert.deepEqual(vite.watcher.getWatched(), {})
    assert.equal(server.listenerCount('upgrade'), 0)
  } finally {
    await development.close()
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    process.chdir(previousDirectory)
    rmSync(directory, { recursive: true, force: true })
  }
})
