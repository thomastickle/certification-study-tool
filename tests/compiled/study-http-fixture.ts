import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { request } from 'node:http'
import type { Server } from 'node:http'
import { createApplication } from '../../src/server/application.ts'
import { oidcFixture, closeServer } from '../oidc-fixture.ts'
import { runtimeConfiguration } from '../../src/server/runtime/runtime-configuration.ts'

/** Exercise admission with raw targets; fetch would normalize away the attack. */
export async function fixture(
  beforeTokenExchange?: () => Promise<void>,
  features: import('@nestjs/common').DynamicModule['imports'] = [],
) {
  const directory = mkdtempSync(join(tmpdir(), 'nest-security-'))
  const administrators = new Set(['alice'])
  const provider = await oidcFixture(
    '/realms/test',
    (subject) => ({ study_roles: administrators.has(subject) ? ['admin'] : [] }),
    beforeTokenExchange,
  )
  const config = runtimeConfiguration({
    STUDY_DB_PATH: join(directory, 'library.sqlite3'),
    STUDY_OIDC_ISSUER: provider.issuerIdentifier,
  })
  let now = Date.now()
  config.authentication.now = () => now
  let app = await createApplication(config, features)
  await app.listen(0, '127.0.0.1')
  const server = app.getHttpServer() as Server
  let address = server.address()
  assert.ok(address && typeof address !== 'string')

  let port = address.port

  const call = (
    path: string,
    method = 'GET',
    headers: Record<string, string> = {},
    data?: string,
  ) =>
    new Promise<{ status: number; body: string; headers: import('node:http').IncomingHttpHeaders }>(
      (resolve, reject) => {
        const req = request(
          {
            host: '127.0.0.1',
            port,
            path,
            method,
            headers: { Host: config.origin.host, Origin: config.origin.origin, ...headers },
          },
          (res) => {
            let body = ''
            res.on('error', reject)
            res.setEncoding('utf8')
            res.on('data', (chunk) => {
              body += chunk
            })
            res.on('end', () => resolve({ status: res.statusCode!, body, headers: res.headers }))
          },
        )
        req.on('error', reject)
        req.end(data)
      },
    )

  const sessions = new Map<string, string>()

  const authorized = (
    path: string,
    session: string,
    method = 'GET',
    headers: Record<string, string> = {},
    data?: string,
  ) =>
    call(
      path,
      method,
      { Cookie: session, 'X-Study-Account': sessions.get(session) ?? '', ...headers },
      data,
    )

  async function authorize(subject: string) {
    const start = await call('/auth/login')
    assert.equal(start.status, 302)
    const cookie = start.headers['set-cookie']![0]!.split(';')[0]!
    const url = new URL(start.headers.location!)
    url.searchParams.set('user', subject)
    const result = await fetch(url, { redirect: 'manual' })
    const callback = new URL(result.headers.get('location')!)
    return { cookie, path: callback.pathname + callback.search }
  }

  async function login(subject: string, previous = '') {
    const attempt = await authorize(subject)
    const response = await call(attempt.path, 'GET', {
      Cookie: [attempt.cookie, previous].filter(Boolean).join('; '),
    })
    assert.equal(response.status, 302)
    const cookie = response.headers['set-cookie']!.find((value) =>
      value.startsWith('study_session='),
    )!.split(';')[0]!
    const session = await call('/api/session', 'GET', { Cookie: cookie })
    sessions.set(cookie, JSON.parse(session.body).user.id)
    return cookie
  }

  return {
    get app() {
      return app
    },
    restart: async () => {
      await app.close()
      app = await createApplication(config, features)
      await app.listen(0, '127.0.0.1')
      address = (app.getHttpServer() as Server).address()
      assert.ok(address && typeof address !== 'string')
      port = address.port
    },
    call,
    authorized,
    authorize,
    login,
    config,
    provider,
    administrators,
    sessions,
    advance: (ms: number) => {
      now += ms
    },
    port,
    close: async () => {
      await app.close()
      await closeServer(provider.server)
      rmSync(directory, { recursive: true, force: true })
    },
  }
}
