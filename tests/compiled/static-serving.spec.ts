import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { runtimeConfiguration } from '../../src/server/runtime/runtime-configuration.ts'

test('production static admission, API exclusion and partial-stream shutdown remain owned', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'study-static-production-'))
  writeFileSync(join(directory, 'index.html'), 'shell')
  writeFileSync(join(directory, 'large.js'), Buffer.alloc(16 * 1024 * 1024, 120))
  const configuration = runtimeConfiguration({
    NODE_ENV: 'production',
    STUDY_DB_PATH: join(directory, 'library.sqlite3'),
  })
  configuration.staticRoot = directory
  const { createProductionApplication } = await import('../../src/server/production-application.ts')
  const { ApplicationRuntime } = await import('../../src/server/runtime/application-runtime.ts')
  const app = await createProductionApplication(configuration)
  try {
    await app.listen(0, '127.0.0.1')
    const address = app.getHttpServer().address()
    assert.ok(address && typeof address !== 'string')
    configuration.origin.port = String(address.port)
    const origin = configuration.origin.origin
    for (const path of ['/api/home', '/api/session', '/api/unknown', '/auth/unknown']) {
      const response = await fetch(origin + path)
      let expected = 404
      if (path.startsWith('/api/')) {
        expected = 401
      }
      if (path === '/api/session') {
        expected = 200
      }
      assert.equal(response.status, expected)
      assert.match(response.headers.get('content-type')!, /application\/json/)
      assert.notEqual(await response.text(), 'shell')
    }
    for (const headers of [
      { Host: 'hostile.invalid' },
      { Origin: 'https://hostile.invalid' },
    ] as Record<string, string>[]) {
      const req = request(origin + '/large.js', { headers })
      req.end()
      const [response] = await once(req, 'response')
      response.resume()
      assert.equal(response.statusCode, 403)
      await once(response, 'end')
    }
    assert.equal(
      (
        await fetch(origin + '/large.js', {
          headers: { 'Sec-Fetch-Site': 'cross-site' },
          method: 'HEAD',
        })
      ).status,
      403,
      'cross-site asset requests retain admission policy',
    )
    const raw = request(origin, { path: 'http://hostile.invalid/large.js' })
    raw.end()
    const [rejected] = await once(raw, 'response')
    rejected.resume()
    assert.equal(rejected.statusCode, 403)
    await once(rejected, 'end')
    for (let attempt = 0; attempt < 3; attempt++) {
      const req = request(origin + '/large.js')
      req.end()
      const [response] = await once(req, 'response')
      await once(response, 'data')
      response.destroy()
      await once(response, 'close')
    }
    const req = request(origin + '/large.js')
    req.end()
    const [response] = await once(req, 'response')
    await once(response, 'data')
    response.pause()
    response.on('error', () => {})
    await app.close()
    response.destroy()
    req.destroy()
    assert.throws(
      () => app.get(ApplicationRuntime).sharedLibrary.quizStore().nextHousekeepingAt(),
      /closed|not open/,
    )
  } finally {
    await app.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
