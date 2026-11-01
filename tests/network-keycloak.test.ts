import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { configureKeycloak } from '../scripts/network-keycloak.ts'

for (const denied of [false, true]) {
  test(`existing Keycloak callback configuration ${denied ? 'rejects bad credentials before updating' : 'preserves callbacks and client attributes'}`, async (testContext) => {
    const root = mkdtempSync(join(tmpdir(), 'study-network-keycloak-'))
    testContext.after(() => rmSync(root, { recursive: true, force: true }))
    let updated: Record<string, unknown> | undefined
    const server = createServer(async (request, response) => {
      if (request.url?.endsWith('/token')) {
        response.writeHead(denied ? 401 : 200, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify(denied ? {} : { access_token: 'synthetic' }))
      } else if (request.method === 'GET') {
        assert.equal(request.headers.authorization, 'Bearer synthetic')
        response.writeHead(200, { 'Content-Type': 'application/json' })
        response.end(
          JSON.stringify([
            {
              id: 'client',
              redirectUris: ['http://127.0.0.1:3000/auth/callback'],
              webOrigins: ['http://127.0.0.1:3000'],
              attributes: {
                retained: 'yes',
                'post.logout.redirect.uris': 'http://127.0.0.1:3000/',
              },
            },
          ]),
        )
      } else if (request.method === 'PUT') {
        let body = ''
        for await (const chunk of request) {
          body += String(chunk)
        }
        updated = JSON.parse(body)
        response.writeHead(204).end()
      } else {
        response.writeHead(404).end()
      }
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    testContext.after(() => server.close())
    const address = server.address()
    assert.ok(address && typeof address !== 'string')
    const profile = {
      hostname: 'study-test.local',
      address: '192.168.1.10',
      httpsPort: 3443,
      enrollmentPort: 3080,
      webPort: 3000,
      keycloakPort: address.port,
    }
    const environment = { KC_BOOTSTRAP_ADMIN_PASSWORD: 'synthetic-password' }
    if (denied) {
      await assert.rejects(configureKeycloak(profile, environment, root), /login failed/)
      assert.equal(updated, undefined)
    } else {
      await configureKeycloak(profile, environment, root)
      assert.deepEqual(updated, {
        redirectUris: [
          'http://127.0.0.1:3000/auth/callback',
          'https://study-test.local:3443/auth/callback',
        ],
        webOrigins: ['http://127.0.0.1:3000', 'https://study-test.local:3443'],
        attributes: {
          retained: 'yes',
          'post.logout.redirect.uris': 'http://127.0.0.1:3000/##https://study-test.local:3443/',
        },
      })
      const backup = readFileSync(join(root, 'keycloak-client-before.json'), 'utf8')
      assert.ok(!backup.includes('synthetic-password'))
      assert.ok(!backup.includes('Bearer'))
    }
  })
}
