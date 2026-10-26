import assert from 'node:assert/strict'
import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { OwnerAuthentication } from '../src/server/auth/owner-authentication.ts'
import { OidcLogin } from '../src/server/auth/oidc-login.ts'

test('pending sign-ins reserve capacity across asynchronous provider work', async (t) => {
  let release!: () => void
  const provider = new Promise<void>((resolve) => {
    release = resolve
  })
  t.mock.method(OidcLogin.prototype, 'begin', async () => {
    await provider
    return {
      url: new URL('https://identity.example/authorize'),
      transaction: { state: 'test-state', verifier: 'test-verifier', nonce: 'test-nonce' },
    }
  })
  const directory = mkdtempSync(join(tmpdir(), 'study-login-capacity-'))
  const app = new OwnerAuthentication({
    accountsPath: join(directory, 'accounts.sqlite3'),
    ownerSubject: 'alice',
    issuer: 'https://identity.example',
    clientId: 'study-tool',
    origin: new URL('http://127.0.0.1:3000'),
  })
  const requests: IncomingMessage[] = []
  const responses: ServerResponse[] = []
  try {
    // Real Node HTTP messages without connected sockets keep the 1,001-request boundary deterministic.
    const pending = Array.from({ length: 1001 }, () => {
      const request = new IncomingMessage(new Socket())
      request.method = 'GET'
      request.url = '/auth/login'
      request.headers = { host: '127.0.0.1:3000' }
      requests.push(request)
      const response = new ServerResponse(request)
      responses.push(response)
      return app.handle(request, response)
    })
    release()
    await Promise.all(pending)
    assert.equal(responses.filter((response) => response.statusCode === 302).length, 1000)
    assert.equal(responses.filter((response) => response.statusCode === 429).length, 1)
  } finally {
    release()
    for (const response of responses) response.destroy()
    for (const request of requests) request.socket.destroy()
    app.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
