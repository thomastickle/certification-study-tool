import { prepareRuntimeDatabase } from '../managed-database-fixture.ts'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createProductionApplication } from '../../src/server/production-application.ts'
import { DevelopmentApplication } from '../../src/server/web/development-application.ts'
import { ApplicationRuntime } from '../../src/server/runtime/application-runtime.ts'
import { runtimeConfiguration } from '../../src/server/runtime/runtime-configuration.ts'
import { observeRuntime } from './runtime-observation.ts'
import { closeServer } from '../oidc-fixture.ts'

test('stock child executes local Vite SSR plugins and releases its real Nest runtime', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'nest-dev-ssr-'))
  const reservation = createServer()
  reservation.listen(0, '127.0.0.1')
  await once(reservation, 'listening')
  const address = reservation.address()
  assert.ok(address && typeof address !== 'string')
  await closeServer(reservation)
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
  const configuration = runtimeConfiguration({
    STUDY_PORT: String(address.port),
    STUDY_DB_PATH: join(directory, 'library.sqlite3'),
  })
  prepareRuntimeDatabase(configuration.databasePath)
  const owner = new DevelopmentApplication(configuration, directory)
  try {
    await owner.start()
    const runtime = (await owner.backend).get(ApplicationRuntime)
    const response = await fetch(configuration.origin.origin + '/ssr-probe')
    assert.equal(response.status, 200)
    assert.equal(await response.text(), '42')
    await owner.close()
    assert.throws(() => runtime.sharedLibrary.quizStore().nextHousekeepingAt(), /closed|not open/)
  } finally {
    await owner.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('static factory rejects obsolete development composition after closing acquired roots', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'nest-dev-factory-'))
  const observation = observeRuntime()
  try {
    const configuration = runtimeConfiguration({
      STUDY_DB_PATH: join(directory, 'library.sqlite3'),
    })
    prepareRuntimeDatabase(configuration.databasePath)
    await assert.rejects(createProductionApplication(configuration), /DevelopmentApplication/)
    assert.throws(() => observation.runtime.sharedLibrary.sources(), /closed|not open/)
  } finally {
    observation.restore()
    rmSync(directory, { recursive: true, force: true })
  }
})
