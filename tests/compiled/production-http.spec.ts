import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { runtimeConfiguration } from '../../src/server/runtime-configuration.ts'

test('full production composition serves public assets and keeps APIs behind Nest guards', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'nest-production-'))
  writeFileSync(join(directory, 'asset.js'), 'export default 1')
  writeFileSync(join(directory, 'index.html'), '<title>owned shell</title>')
  const configuration = runtimeConfiguration({
    NODE_ENV: 'production',
    STUDY_DB_PATH: join(directory, 'library.sqlite3'),
  })
  configuration.staticRoot = directory
  const { createProductionApplication } = await import('../../src/server/production-application.ts')
  const app = await createProductionApplication(configuration)
  try {
    await app.init()
    await app.listen(0, '127.0.0.1')
    const address = app.getHttpServer().address()
    assert.ok(address && typeof address !== 'string')
    configuration.origin.port = String(address.port)
    const origin = configuration.origin.origin
    const shell = await fetch(origin + '/study')
    assert.equal(shell.status, 200)
    assert.equal(await shell.text(), '<title>owned shell</title>')
    assert.equal(shell.headers.get('cache-control'), 'no-cache')
    assert.equal((await fetch(origin + '/api/home')).status, 401)
    assert.equal((await fetch(origin + '/api/missing')).status, 401)
    assert.equal((await fetch(origin + '/auth/missing')).status, 404)
    const asset = await fetch(origin + '/asset.js')
    assert.equal(asset.headers.get('content-type'), 'text/javascript')
    assert.equal(asset.headers.get('x-content-type-options'), 'nosniff')
    assert.equal((await fetch(origin + '/missing.js')).status, 404)
    assert.equal((await fetch(origin + '/bad%ZZ')).status, 404)
    for (const path of ['/api', '/auth']) {
      assert.equal(
        (await fetch(origin + path)).status,
        200,
        'bare prefixes remain public SPA paths',
      )
    }
    assert.equal(
      (await fetch(origin + '/study', { method: 'POST', headers: { Origin: origin } })).status,
      405,
    )
    for (const method of ['HEAD', 'OPTIONS']) {
      assert.equal(
        (await fetch(origin + '/api/unknown', { method, headers: { Origin: origin } })).status,
        401,
      )
      assert.equal(
        (await fetch(origin + '/auth/unknown', { method, headers: { Origin: origin } })).status,
        404,
      )
    }
    const head = await fetch(origin + '/', { method: 'HEAD' })
    assert.equal(head.status, 200)
    assert.equal(await head.text(), '')
  } finally {
    await app.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('shutdown rejects admission while web disposal is gated and roots remain owned', async () => {
  const { PublicWeb } = await import('../../src/server/public-web.ts')
  const { createApplication } = await import('../../src/server/application.ts')
  const { ApplicationRuntime } = await import('../../src/server/application-runtime.ts')
  let enter!: () => void
  let release!: () => void
  const entered = new Promise<void>((resolve) => {
    enter = resolve
  })
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })

  class GatedWeb extends PublicWeb {
    async close(): Promise<void> {
      enter()
      await gate
      await super.close()
    }
  }

  const directory = mkdtempSync(join(tmpdir(), 'nest-web-drain-'))
  writeFileSync(join(directory, 'index.html'), 'fixture')
  const configuration = runtimeConfiguration({
    NODE_ENV: 'production',
    STUDY_DB_PATH: join(directory, 'library.sqlite3'),
  })
  configuration.staticRoot = directory
  const app = await createApplication(configuration, [], new GatedWeb())
  const runtime = app.get(ApplicationRuntime)
  try {
    await app.listen(0, '127.0.0.1')
    const address = app.getHttpServer().address()
    assert.ok(address && typeof address !== 'string')
    configuration.origin.port = String(address.port)
    const closing = app.close()
    await entered
    runtime.sharedLibrary.quizStore().nextHousekeepingAt()
    assert.equal((await fetch(configuration.origin.origin + '/api/health')).status, 503)
    release()
    await closing
    assert.throws(() => runtime.sharedLibrary.quizStore().nextHousekeepingAt(), /closed|not open/)
  } finally {
    release()
    await app.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
