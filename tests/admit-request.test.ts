import assert from 'node:assert/strict'
import { IncomingMessage } from 'node:http'
import { Socket } from 'node:net'
import { test } from 'node:test'
import { admitRequest } from '../src/server/http/admit-request.ts'
import { ApplicationError } from '../src/server/http/errors.ts'

const origin = new URL('http://localhost:43219')

/** Model the raw Node boundary without creating authentication storage. */
function request(url: string, headers: IncomingMessage['headers'] = {}, method = 'GET') {
  const incoming = new IncomingMessage(new Socket())
  incoming.url = url
  incoming.method = method
  incoming.headers = { host: origin.host, ...headers }
  return incoming
}

test('raw admission preserves normalized routing and returns an immutable snapshot', () => {
  const admitted = admitRequest(request('/public/%2e%2e/api/health?x=1&x=2'), origin)
  assert.deepEqual(admitted, { pathname: '/api/health', search: '?x=1&x=2' })
  assert.equal(Object.isFrozen(admitted), true)
  assert.deepEqual(admitRequest(request('/%ZZ'), origin), { pathname: '/%ZZ', search: '' })
})

test('raw admission rejects foreign authority, host, origin and unsafe navigation', () => {
  const cases = [
    request('http://foreign.example/api/health'),
    request('//foreign.example/api/health'),
    request('/', { host: 'foreign.example' }),
    request('/', { origin: 'http://foreign.example' }),
    request('/api/health', { 'sec-fetch-site': 'cross-site' }),
    request('/auth/logout', {}, 'POST'),
    request('/', { 'sec-fetch-site': 'cross-site' }, 'HEAD'),
  ]
  for (const incoming of cases) {
    assert.throws(
      () => admitRequest(incoming, origin),
      (error: unknown) => {
        assert.ok(error instanceof ApplicationError)
        assert.equal(error.status, 403)
        return true
      },
    )
  }
})

test('provider return and public navigation remain admitted without trusting forwarded headers', () => {
  for (const path of ['/', '/workspace', '/auth/callback', '/API/health']) {
    assert.equal(
      admitRequest(request(path, { 'sec-fetch-site': 'cross-site' }), origin).pathname,
      path,
    )
  }
  assert.equal(
    admitRequest(
      request('/api/health', {
        'x-forwarded-host': 'foreign.example',
        'x-forwarded-proto': 'https',
      }),
      origin,
    ).pathname,
    '/api/health',
  )
  assert.equal(
    admitRequest(request('/auth/logout', { origin: origin.origin }, 'POST'), origin).pathname,
    '/auth/logout',
  )
  assert.throws(() => admitRequest(request('http://['), origin), TypeError)
})
