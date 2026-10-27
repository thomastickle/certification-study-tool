import assert from 'node:assert/strict'
import type { Server } from 'node:http'
import { request } from 'node:http'
import { test } from 'node:test'
import { createApplication } from '../../src/server/application.ts'

test('compiled Nest decorators serve health through DI and close the listening application', async () => {
  const app = await createApplication()
  const server = app.getHttpServer() as Server
  try {
    await app.listen(0, '127.0.0.1')
    const address = server.address()
    assert.ok(address && typeof address !== 'string')
    const response = await fetch(`http://127.0.0.1:${address.port}/api/health`)
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { status: 'ok' })

    // An eager Express JSON parser would return 400 before future guards could reject this.
    const status = await new Promise<number | undefined>((done, reject) => {
      const req = request(
        `http://127.0.0.1:${address.port}/api/health`,
        { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': 1 } },
        (response) => {
          response.resume()
          response.on('end', () => done(response.statusCode))
        },
      )
      req.on('error', reject)
      req.end('{')
    })
    assert.equal(status, 404, 'The foundation must leave JSON parsing to later authorized routes')
  } finally {
    await app.close()
  }
  assert.equal(server.listening, false)
  assert.equal(server.address(), null)
})
