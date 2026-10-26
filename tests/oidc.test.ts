import assert from 'node:assert/strict'
import { test } from 'node:test'
import { OidcLogin } from '../src/server/auth/oidc-login.ts'
import { closeServer, oidcFixture } from './oidc-fixture.ts'

test('OIDC discovers the issuer, uses code with PKCE, and returns a verified stable identity', async () => {
  const fixture = await oidcFixture()
  try {
    const login = new OidcLogin({
      issuer: fixture.issuerIdentifier,
      clientId: 'study-tool',
      origin: new URL('http://127.0.0.1:3000'),
    })
    const { url, transaction } = await login.begin()
    assert.equal(url.origin, fixture.issuer.origin)
    assert.equal(url.searchParams.get('response_type'), 'code')
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256')
    assert.equal(url.searchParams.get('scope'), 'openid profile')
    const response = await fetch(url, { redirect: 'manual' })
    const identity = await login.complete(new URL(response.headers.get('location')!), transaction)
    assert.deepEqual(identity, { issuer: fixture.issuer.href, subject: 'alice', name: 'alice' })
  } finally {
    await closeServer(fixture.server)
  }
})

for (const error of ['signature', 'issuer', 'audience', 'nonce', 'expired'] as const) {
  test(`OIDC rejects an ID token with invalid ${error}`, async () => {
    const fixture = await oidcFixture()
    try {
      fixture.invalidate(error)
      const login = new OidcLogin({
        issuer: fixture.issuerIdentifier,
        clientId: 'study-tool',
        origin: new URL('http://127.0.0.1:3000'),
      })
      const { url, transaction } = await login.begin()
      const response = await fetch(url, { redirect: 'manual' })
      await assert.rejects(login.complete(new URL(response.headers.get('location')!), transaction))
    } finally {
      await closeServer(fixture.server)
    }
  })
}

test('OIDC rejects a callback with another browser state or a wrong PKCE verifier', async () => {
  const fixture = await oidcFixture()
  try {
    const login = new OidcLogin({
      issuer: fixture.issuerIdentifier,
      clientId: 'study-tool',
      origin: new URL('http://127.0.0.1:3000'),
    })
    for (const changed of [{ state: 'wrong' }, { verifier: 'wrong' }]) {
      const { url, transaction } = await login.begin()
      const response = await fetch(url, { redirect: 'manual' })
      await assert.rejects(
        login.complete(new URL(response.headers.get('location')!), { ...transaction, ...changed }),
      )
    }
  } finally {
    await closeServer(fixture.server)
  }
})

test('HTTP OIDC and application origins are limited to loopback', () => {
  const valid = {
    issuer: 'http://127.0.0.1:8080/realms/study',
    clientId: 'study-tool',
    origin: new URL('http://localhost:3000'),
  }
  assert.doesNotThrow(() => new OidcLogin(valid))
  assert.throws(
    () => new OidcLogin({ ...valid, issuer: 'http://192.168.1.5:8080/realms/study' }),
    /HTTPS/,
  )
  assert.throws(() => new OidcLogin({ ...valid, origin: new URL('http://study.example') }), /HTTPS/)
  assert.throws(
    () => new OidcLogin({ ...valid, origin: new URL('http://localhost:3000/some-path') }),
    /origin/,
  )
})
