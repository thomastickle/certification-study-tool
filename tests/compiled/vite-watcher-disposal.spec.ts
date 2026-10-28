import 'reflect-metadata'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createServer } from 'node:http'
import { syncBuiltinESMExports } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setImmediate as nextTurn, setTimeout as delay } from 'node:timers/promises'
import { test } from 'node:test'
import type { ViteDevServer } from 'vite'
import { ApplicationRuntime } from '../../src/server/application-runtime.ts'
import { createProductionApplication } from '../../src/server/production-application.ts'
import { runtimeConfiguration } from '../../src/server/runtime-configuration.ts'

type StatTail = { path: string; deliver: () => void }

const tails: StatTail[] = []
const nativeWatches: { path: string; closed: boolean; watcher: fs.FSWatcher }[] = []
let heldPaths: string[] = []
const originalStat = fs.stat
const originalWatch = fs.watch
// Install before Vite imports/promisifies stat. Only selected real ENOENT completions are deferred.
fs.stat = ((path: unknown, ...args: unknown[]) => {
  const callback = args.pop() as (...args: unknown[]) => void
  return Reflect.apply(originalStat, fs, [
    path,
    ...args,
    (error: NodeJS.ErrnoException | null, stats: unknown) => {
      if (error?.code === 'ENOENT' && heldPaths.includes(String(path))) {
        tails.push({ path: String(path), deliver: () => callback(error, stats) })
      } else {
        callback(error, stats)
      }
    },
  ])
}) as typeof fs.stat
fs.watch = ((...args: unknown[]) => {
  const watcher = Reflect.apply(originalWatch, fs, args) as fs.FSWatcher
  const record = { path: String(args[0]), closed: false, watcher }
  nativeWatches.push(record)
  watcher.once('close', () => {
    record.closed = true
  })
  return watcher
}) as typeof fs.watch
syncBuiltinESMExports()

/** Wait for an acknowledged filesystem boundary, rather than guessing when enumeration finishes. */
async function until(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 1000; attempt++) {
    if (predicate()) {
      return
    }
    await delay(5)
  }
  assert.fail('Filesystem acknowledgement timed out')
}

/** Deliver one real missing-file completion while retaining other outstanding callbacks. */
function deliverStatFailure(path: string): void {
  const index = tails.findIndex((tail) => tail.path === path)
  assert.notEqual(index, -1, `No deferred stat completion for ${path}`)
  tails.splice(index, 1)[0]!.deliver()
}

/** Inspect Chokidar's terminal state alongside independent native resource observations. */
function isWatcherClosed(vite: ViteDevServer): boolean {
  return (vite.watcher as unknown as { closed: boolean }).closed
}

for (const mode of ['metadata control', 'reopening control', 'Nest disposal']) {
  test(`delayed filesystem completions: ${mode}`, { timeout: 15000 }, async () => {
    const directory = fs.mkdtempSync(join(tmpdir(), 'study-vite-stat-tail-'))
    const previous = process.cwd()
    const files = ['one.txt', 'two.txt'].map((name) => join(directory, name))
    const nativeStart = nativeWatches.length
    const baseline = process
      .getActiveResourcesInfo()
      .filter((name) => name === 'FSEventWrap').length
    const http = createServer()
    let vite: ViteDevServer | undefined
    let app: Awaited<ReturnType<typeof createProductionApplication>> | undefined
    let runtime: ApplicationRuntime | undefined
    const globals = globalThis as unknown as { __statTailVite?: ViteDevServer }
    const events: string[] = []
    try {
      files.forEach((path) => fs.writeFileSync(path, 'fixture'))
      fs.writeFileSync(join(directory, 'index.html'), '<title>Fixture</title>')
      process.chdir(directory)
      if (mode === 'Nest disposal') {
        fs.writeFileSync(
          join(directory, 'vite.config.mts'),
          `export default { plugins: [{ name: 'capture', configureServer(server) { globalThis.__statTailVite = server } }] }`,
        )
        const configuration = runtimeConfiguration({
          STUDY_DB_PATH: join(directory, 'library.sqlite3'),
        })
        configuration.port = 0
        app = await createProductionApplication(configuration)
        runtime = app.get<ApplicationRuntime>(ApplicationRuntime)
        await app.listen(0, '127.0.0.1')
        vite = globals.__statTailVite
      } else {
        const { createServer: createVite } = await import('vite')
        vite = await createVite({ server: { middlewareMode: true, hmr: { server: http } } })
      }
      assert.ok(vite)
      const graph = vite
      await until(() =>
        files.every((path) =>
          nativeWatches.slice(nativeStart).some((watch) => watch.path === path),
        ),
      )
      heldPaths = files
      files.forEach((path) => fs.unlinkSync(path))
      await until(() => files.every((path) => tails.some((tail) => tail.path === path)))
      if (app) {
        await app.close()
      } else {
        await graph.close()
        await graph.watcher.close()
      }
      await nextTurn()
      await nextTurn()
      assert.equal(isWatcherClosed(graph), true)
      assert.ok(nativeWatches.slice(nativeStart).every((watch) => watch.closed))
      graph.watcher.on('all', (event) => events.push(event))
      graph.watcher.on('raw', (event) => events.push(event))
      // Two distinct removals are significant: the first leaves an empty parent entry; the second
      // sees one watched directory and Chokidar's missing-file recovery calls public add().
      deliverStatFailure(files[0]!)
      await nextTurn()
      await nextTurn()
      assert.deepEqual(graph.watcher.getWatched(), { [directory]: [] })
      assert.equal(
        isWatcherClosed(graph),
        true,
        'Empty metadata alone does not mean an active watcher',
      )
      assert.ok(nativeWatches.slice(nativeStart).every((watch) => watch.closed))
      if (mode !== 'metadata control') {
        deliverStatFailure(files[1]!)
        if (mode === 'reopening control') {
          await until(() => nativeWatches.slice(nativeStart).some((watch) => !watch.closed))
          assert.equal(
            isWatcherClosed(graph),
            false,
            'Unmodified Vite/Chokidar is the deliberate-leak control',
          )
        } else {
          await nextTurn()
          await nextTurn()
          assert.equal(
            isWatcherClosed(graph),
            true,
            'Disposed graph cannot reopen from a delayed stat failure',
          )
          assert.ok(nativeWatches.slice(nativeStart).every((watch) => watch.closed))
        }
        // A separate native observer acknowledges the post-close mutation. The unmodified control
        // must emit too, proving that this observation would detect the leaked watcher.
        let observed = false
        const observer = originalWatch(directory, () => {
          observed = true
        })
        try {
          fs.writeFileSync(files[1]!, 'post-close mutation')
          await until(() => observed)
          if (mode === 'reopening control') {
            await until(() => events.length > 0)
          } else {
            assert.deepEqual(events, [])
          }
        } finally {
          observer.close()
          await nextTurn()
          await nextTurn()
        }
      }
      if (runtime) {
        const disposed = runtime
        assert.throws(
          () => disposed.sharedLibrary.quizStore().nextHousekeepingAt(),
          /closed|not open/,
        )
        assert.throws(() => disposed.authentication.legacyOwnerId('closed'), /closed|not open/)
        assert.equal(
          process.getActiveResourcesInfo().filter((name) => name === 'FSEventWrap').length,
          baseline,
        )
      }
    } finally {
      heldPaths = []
      tails.splice(0).forEach((tail) => tail.deliver())
      await nextTurn()
      await nextTurn()
      await vite?.close()
      await vite?.watcher.close()
      await app?.close()
      await nextTurn()
      await nextTurn()
      // Close exact captured native handles even if an earlier red assertion interrupted disposal.
      for (const watch of nativeWatches.slice(nativeStart)) {
        watch.watcher.close()
      }
      await nextTurn()
      await nextTurn()
      assert.ok(nativeWatches.slice(nativeStart).every((watch) => watch.closed))
      http.closeAllConnections()
      await new Promise<void>((resolve) => http.close(() => resolve()))
      delete globals.__statTailVite
      process.chdir(previous)
      fs.rmSync(directory, { recursive: true, force: true })
    }
  })
}

test.after(() => {
  fs.stat = originalStat
  fs.watch = originalWatch
  syncBuiltinESMExports()
})
