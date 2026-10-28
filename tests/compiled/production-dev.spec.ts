import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createProductionApplication } from '../../src/server/production-application.ts'
import { ApplicationRuntime } from '../../src/server/application-runtime.ts'
import { runtimeConfiguration } from '../../src/server/runtime-configuration.ts'

test('production development composition serves Vite SSR and releases its runtime', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'nest-dev-ssr-'))
  const previousDirectory = process.cwd()
  writeFileSync(join(directory, 'index.html'), '<title>development fixture</title>')
  writeFileSync(join(directory, 'probe.js'), 'export const answer = 42')
  writeFileSync(
    join(directory, 'vite.config.mjs'),
    `export default { plugins: [{
    name: 'ssr-fixture', configureServer(server) {
      server.middlewares.use('/ssr-probe', (_request, response, next) => {
        void server.ssrLoadModule('/probe.js').then(module => response.end(String(module.answer)), next)
      })
    }
  }] }`,
  )
  const configuration = runtimeConfiguration({ STUDY_DB_PATH: join(directory, 'library.sqlite3') })
  process.chdir(directory)
  let app: Awaited<ReturnType<typeof createProductionApplication>> | undefined
  try {
    app = await createProductionApplication(configuration)
    const runtime = app.get(ApplicationRuntime)
    await app.init()
    await app.listen(0, '127.0.0.1')
    const address = app.getHttpServer().address()
    assert.ok(address && typeof address !== 'string')
    configuration.origin.port = String(address.port)
    const response = await fetch(configuration.origin.origin + '/ssr-probe')
    assert.equal(response.status, 200)
    assert.equal(await response.text(), '42')
    await app.close()
    assert.throws(() => runtime.sharedLibrary.quizStore().nextHousekeepingAt(), /closed|not open/)
  } finally {
    await app?.close()
    process.chdir(previousDirectory)
    rmSync(directory, { recursive: true, force: true })
  }
})
