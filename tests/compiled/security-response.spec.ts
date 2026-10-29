import assert from 'node:assert/strict'
import { HttpException } from '@nestjs/common'
import { createServer } from 'node:http'
import { test } from 'node:test'
import { securityFailure } from '../../src/server/security/security.filter.ts'
import type { AdmittedRequest } from '../../src/server/security/security-context.ts'
import { closeServer } from '../oidc-fixture.ts'

test('non-study Nest failures retain sanitized status and never rewrite completed or partial responses', async () => {
  const server = createServer((request, response) => {
    const error = new HttpException(
      { message: 'private diagnostics' },
      Number(request.url?.slice(1)) || 409,
    )
    if (request.url === '/ended') {
      response.end('complete')
    } else if (request.url === '/partial') {
      response.write('partial')
    }
    securityFailure(error, request as AdmittedRequest, response)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const origin = `http://127.0.0.1:${address.port}`
  try {
    for (const [status, message] of [
      [401, 'Unauthorized'],
      [403, 'Forbidden'],
      [409, 'Conflict'],
      [500, 'The request could not be completed. Please retry.'],
      [503, 'The request could not be completed. Please retry.'],
    ] as const) {
      const response = await fetch(`${origin}/${status}`)
      assert.equal(response.status, status)
      assert.deepEqual(await response.json(), { error: message })
      assert.equal(response.headers.get('cache-control'), 'no-store')
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
    }
    assert.equal(await (await fetch(`${origin}/ended`)).text(), 'complete')
    await assert.rejects(async () => {
      const response = await fetch(`${origin}/partial`)
      await response.text()
    })
  } finally {
    await closeServer(server)
  }
})
