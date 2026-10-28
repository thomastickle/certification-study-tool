import assert from 'node:assert/strict'
import { test } from 'node:test'
import { OidcLogin } from '../../src/server/auth/oidc-login.ts'
import { libraryFixture } from './library-http-fixture.ts'

test(
  'pending sign-ins reserve capacity across asynchronous provider work',
  { timeout: 30000 },
  async (t) => {
    let release!: () => void
    const provider = new Promise<void>((resolve) => {
      release = resolve
    })
    let reserved!: () => void
    const full = new Promise<void>((resolve) => {
      reserved = resolve
    })
    let starts = 0
    t.mock.method(OidcLogin.prototype, 'begin', async () => {
      starts += 1
      if (starts === 1000) {
        reserved()
      }
      await provider
      return {
        url: new URL('https://identity.example/authorize'),
        transaction: { state: 'test-state', verifier: 'test-verifier', nonce: 'test-nonce' },
      }
    })
    const f = await libraryFixture()
    let denied!: () => void
    const rejected = new Promise<void>((resolve) => {
      denied = resolve
    })
    const pending = Array.from({ length: 1001 }, () =>
      f.call('/auth/login').then((response) => {
        if (response.status === 429) {
          denied()
        }
        return response
      }),
    )
    try {
      await Promise.all([full, rejected])
      release()
      const responses = await Promise.all(pending)
      assert.equal(responses.filter((response) => response.status === 302).length, 1000)
      assert.equal(responses.filter((response) => response.status === 429).length, 1)
      assert.equal(starts, 1000, 'Denied requests must not begin provider work')
    } finally {
      release()
      await Promise.allSettled(pending)
      await f.close()
    }
  },
)
