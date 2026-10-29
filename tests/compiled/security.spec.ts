import { ApplicationOwner } from '../../src/server/runtime/application-owner.ts'
import assert from 'node:assert/strict'
import { APP_PIPE, NestFactory } from '@nestjs/core'
import type { ArgumentMetadata } from '@nestjs/common'
import type { LibraryRepository } from '../../src/server/questions/library-repository.ts'
import type { SessionUser } from '../../src/shared/auth-contracts.ts'
import { StudyLibraryScope } from '../../src/server/runtime/study-library-scope.ts'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer, request } from 'node:http'
import { createConnection } from 'node:net'
import type { Server } from 'node:http'
import { mock, test } from 'node:test'
import { setImmediate } from 'node:timers/promises'
import { createApplication } from '../../src/server/application.ts'
import { oidcFixture, closeServer } from '../oidc-fixture.ts'
import {
  ProbeModule,
  ProbeWork,
  FeatureAliases,
  FailureModule,
  UnownedBodyModule,
  UnownedPipeModule,
  UnscopedBodyModule,
  UnownedClassPipeModule,
  inheritedInputModule,
} from './security-probes.ts'
import { ApplicationRuntime } from '../../src/server/runtime/application-runtime.ts'
import { RuntimeStartup } from '../../src/server/runtime/runtime-startup.ts'
import { ApplicationAuthentication } from '../../src/server/auth/application-authentication.ts'
import { bank } from '../fixtures.ts'
import { runtimeConfiguration } from '../../src/server/runtime/runtime-configuration.ts'

/** Exercise admission with raw targets; fetch would normalize away the attack. */
async function fixture(
  beforeTokenExchange?: () => Promise<void>,
  features: import('@nestjs/common').DynamicModule['imports'] = [],
  configureApplication?: (app: Awaited<ReturnType<typeof createApplication>>) => void,
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
  const app = await createApplication(config, [ProbeModule, ...features])
  configureApplication?.(app)
  await app.listen(0, '127.0.0.1')
  const server = app.getHttpServer() as Server
  const address = server.address()
  assert.ok(address && typeof address !== 'string')

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
            port: address.port,
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
    app,
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
    port: address.port,
    close: async () => {
      await app.close()
      await closeServer(provider.server)
      rmSync(directory, { recursive: true, force: true })
    },
  }
}

test('real Nest admission protects normalized unknown APIs and method-specific public endpoints', async () => {
  const f = await fixture()
  try {
    assert.equal((await f.call('/api/health')).status, 200)
    assert.deepEqual(JSON.parse((await f.call('/api/session')).body), { user: null })
    for (const path of [
      '/public/%2e%2e/api/missing',
      '/api/health/',
      '/API/health',
      '/api/%68ealth',
      '/api/probe/item/%FF',
    ]) {
      assert.equal((await f.call(path)).status, path.startsWith('/API') ? 404 : 401, path)
    }
    for (const method of ['HEAD', 'OPTIONS', 'POST', 'PROPFIND']) {
      assert.equal((await f.call('/api/health', method)).status, 401, method)
    }
    assert.equal((await f.call('/api/health', 'GET', { Host: 'foreign.example' })).status, 403)
    assert.equal((await f.call('http://foreign.example/api/health')).status, 403)
    assert.equal(
      (await f.call('/api/session', 'GET', { 'Sec-Fetch-Site': 'cross-site' })).status,
      403,
    )
    const missing = await f.call('/auth/login/')
    assert.equal(missing.status, 404)
    assert.deepEqual(JSON.parse(missing.body), { error: 'Not found.' })
  } finally {
    await f.close()
  }
})

test('real OIDC workflows bind sessions, roles and callback cookies, and revoke replaced sessions', async () => {
  const f = await fixture()
  try {
    const alice = await f.login('alice')
    const bob = await f.login('bob')
    assert.notEqual(f.sessions.get(alice), f.sessions.get(bob))
    assert.equal(JSON.parse((await f.authorized('/api/session', alice)).body).user.role, 'admin')
    assert.equal(JSON.parse((await f.authorized('/api/session', bob)).body).user.role, 'student')
    assert.equal(
      (
        await f.authorized(
          '/api/probe/shared',
          bob,
          'POST',
          { 'Content-Type': 'application/json' },
          '{',
        )
      ).status,
      403,
    )
    const workspace = await f.authorized(
      '/api/probe/private',
      bob,
      'POST',
      { 'X-Study-Account': f.sessions.get(alice)!, 'Content-Type': 'application/json' },
      '{',
    )
    assert.equal(workspace.status, 409)
    assert.deepEqual(JSON.parse(workspace.body), {
      code: 'workspace_changed',
      error: 'Your sign-in changed. Reopen the workspace before continuing.',
    })
    f.administrators.delete('alice')
    assert.equal(
      (
        await f.authorized(
          '/api/probe/shared',
          alice,
          'POST',
          { 'Content-Type': 'application/json' },
          '{}',
        )
      ).status,
      200,
      'role is fixed in the durable session',
    )
    const replacement = await f.login('alice', alice)
    assert.equal((await f.authorized('/api/probe', alice)).status, 401)
    assert.equal((await f.authorized('/api/probe/shared', replacement, 'POST')).status, 403)
    const attempt = await f.authorize('bob')
    assert.equal((await f.call(attempt.path)).status, 400, 'another browser has no transaction')
    assert.equal(
      (
        await f.call(attempt.path, 'GET', {
          Cookie: attempt.cookie,
          'Sec-Fetch-Site': 'cross-site',
        })
      ).status,
      302,
    )
    assert.equal((await f.call(attempt.path, 'GET', { Cookie: attempt.cookie })).status, 400)
    f.provider.invalidate('signature')
    const bad = await f.authorize('bob')
    const failure = await f.call(bad.path, 'GET', { Cookie: bad.cookie })
    assert.equal(failure.status, 400)
    assert.deepEqual(JSON.parse(failure.body), {
      error: 'Sign-in could not be verified. Start sign-in again.',
    })
    assert.ok(failure.headers['set-cookie']!.every((cookie) => cookie.includes('Max-Age=0')))
    assert.equal(
      (await f.authorized('/auth/logout', bob, 'POST', { Origin: 'https://foreign.example' }))
        .status,
      403,
    )
    assert.equal((await f.authorized('/auth/logout', bob, 'POST')).status, 303)
    assert.equal((await f.authorized('/api/probe', bob)).status, 401)
  } finally {
    await f.close()
  }
})

test('guards, normalized consumers, body contract and singleton aliases compose through feature modules', async () => {
  const f = await fixture()
  try {
    const runtime = f.app.get(ApplicationRuntime)
    const aliases = f.app.get(FeatureAliases)
    assert.equal(aliases.runtime, runtime)
    assert.equal(aliases.auth, f.app.get(ApplicationAuthentication))
    assert.equal(aliases.scope, runtime.studyLibraries)
    assert.equal(aliases.shared, runtime.sharedLibrary)
    assert.equal(aliases.config, f.config)
    const bob = await f.login('bob')
    const normalized = await f.authorized('/public/%2e%2e/api/probe?value=first&value=second', bob)
    assert.equal(normalized.status, 200)
    const result = JSON.parse(normalized.body)
    assert.equal(result.first, 'first')
    assert.equal(result.frozen, true)
    assert.equal(result.url.pathname, '/api/probe')
    assert.equal(result.actor.id, f.sessions.get(bob))
    for (const [input, contentType, status, error] of [
      ['{', 'application/json', 400, 'Invalid JSON request. Nothing was imported.'],
      ['null', 'application/json', 400, 'Invalid JSON request. Nothing was imported.'],
      ['[]', 'application/json', 400, 'Invalid JSON request. Nothing was imported.'],
      ['{}', 'Application/JSON', 415, 'Expected application/json.'],
      ['{}', 'application/problem+json', 415, 'Expected application/json.'],
      [
        'x'.repeat(10 * 1024 * 1024 + 1),
        'application/json',
        413,
        'Files must be smaller than 10 MB.',
      ],
    ] as const) {
      const response = await f.authorized(
        '/api/probe/private',
        bob,
        'POST',
        { 'Content-Type': contentType },
        input,
      )
      assert.equal(response.status, status)
      assert.deepEqual(JSON.parse(response.body), { error, details: [] })
      assert.equal(response.headers['cache-control'], 'no-store')
      assert.equal(response.headers['x-content-type-options'], 'nosniff')
    }
    assert.equal(
      (
        await f.authorized(
          '/api/probe/private',
          bob,
          'POST',
          { 'Content-Type': 'application/json-suffix' },
          '{}',
        )
      ).status,
      200,
    )
    assert.deepEqual(JSON.parse((await f.authorized('/api/probe/pause', bob, 'POST')).body), {})
    for (const method of ['HEAD', 'OPTIONS', 'PROPFIND']) {
      assert.equal((await f.authorized('/api/probe', bob, method)).status, 404)
      assert.equal((await f.call('/api/probe', method)).status, 401)
    }
    const expected = await f.authorized('/api/probe/error', bob)
    assert.deepEqual(JSON.parse(expected.body), {
      error: 'Invalid selection.',
      details: ['Choose a source.'],
    })
    const unexpected = await f.authorized('/api/probe/unexpected', bob)
    assert.equal(unexpected.status, 500)
    assert.deepEqual(JSON.parse(unexpected.body), {
      error: 'The local operation failed. No partial import was saved.',
    })
    assert.equal((await f.authorized('/api/probe/ended', bob)).body, 'complete')
    await assert.rejects(f.authorized('/api/probe/partial', bob), /hang up|aborted|reset/i)
    assert.equal((await f.call('/api/health')).status, 200)
  } finally {
    await f.close()
  }
})

/** A controlled prerequisite makes lifetime assertions independent of scheduler timing. */
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

for (const disconnect of [false, true]) {
  test(
    `personal work remains owned through ${disconnect ? 'disconnect and ' : ''}app.close`,
    { timeout: 15000 },
    async () => {
      const f = await fixture()
      const entered = deferred()
      const release = deferred()
      const work = f.app.get(ProbeWork)
      const runtime = f.app.get(ApplicationRuntime)
      work.entered = entered.resolve
      work.release = release.promise
      const events: string[] = []
      const originalObserve = runtime.housekeeping.observeRequest.bind(runtime.housekeeping)
      const observe = mock.method(
        runtime.housekeeping,
        'observeRequest',
        (...args: Parameters<typeof originalObserve>) => {
          events.push('observe')
          originalObserve(...args)
        },
      )
      try {
        const session = await f.login('bob')
        const req = request({
          host: '127.0.0.1',
          port: f.port,
          path: '/api/probe/wait',
          method: 'POST',
          headers: {
            Host: f.config.origin.host,
            Origin: f.config.origin.origin,
            Cookie: session,
            'X-Study-Account': f.sessions.get(session)!,
          },
        })
        req.on('error', () => {})
        req.end()
        await entered.promise
        const personal = work.personal!
        const close = personal.close.bind(personal)
        mock.method(personal, 'close', () => {
          events.push('close')
          close()
        })
        if (disconnect) {
          req.destroy()
        }
        let closed = false
        const closing = f.app.close().then(() => {
          closed = true
        })
        await setImmediate()
        assert.equal(closed, false)
        personal.sources()
        runtime.sharedLibrary.sources()
        runtime.authentication.legacyOwnerId('root-open-during-work')
        release.resolve()
        await closing
        assert.deepEqual(events, ['observe', 'close'])
        assert.throws(() => personal.sources(), /closed|not open/)
        assert.throws(() => runtime!.sharedLibrary.sources(), /closed|not open/)
        assert.throws(() => runtime!.authentication.legacyOwnerId('closed'), /closed|not open/)
      } finally {
        release.resolve()
        observe.mock.restore()
        await f.close()
      }
    },
  )
}

test(
  'real token exchange remains owned when app.close disconnects an OIDC callback',
  { timeout: 15000 },
  async () => {
    const exchange = deferred()
    const release = deferred()
    const f = await fixture(async () => {
      exchange.resolve()
      await release.promise
    })
    try {
      const runtime = f.app.get(ApplicationRuntime)
      const attempt = await f.authorize('bob')
      const completing = f
        .call(attempt.path, 'GET', { Cookie: attempt.cookie })
        .catch(() => undefined)
      await exchange.promise
      let closed = false
      const closing = f.app.close().then(() => {
        closed = true
      })
      await setImmediate()
      assert.equal(closed, false)
      runtime.authentication.legacyOwnerId('open-during-exchange')
      release.resolve()
      await closing
      await completing
      assert.throws(() => runtime!.authentication.legacyOwnerId('closed'), /closed|not open/)
    } finally {
      release.resolve()
      await f.close()
    }
  },
)

test(
  'denied streaming writes do not wait for or buffer bodies; partial admitted bodies drain on shutdown',
  { timeout: 15000 },
  async () => {
    const f = await fixture()
    const runtime = f.app.get(ApplicationRuntime)
    const opened = deferred()
    const observed = deferred()
    let personal:
      import('../../src/server/questions/library-repository.ts').LibraryRepository | undefined
    const originalOpen = runtime.privateLibraries.open.bind(runtime.privateLibraries)
    const originalObserve = runtime.housekeeping.observeRequest.bind(runtime.housekeeping)
    try {
      const bob = await f.login('bob')
      for (const [session, account, expected] of [
        ['', '', 401],
        [bob, 'stale', 409],
        [bob, f.sessions.get(bob)!, 403],
      ]) {
        const status = await new Promise<number>((resolve, reject) => {
          const req = request(
            {
              host: '127.0.0.1',
              port: f.port,
              path: '/api/probe/shared',
              method: 'POST',
              headers: {
                Host: f.config.origin.host,
                Origin: f.config.origin.origin,
                Cookie: session!,
                'X-Study-Account': account!,
                'Content-Type': 'application/json',
                'Content-Length': 20 * 1024 * 1024,
              },
            },
            (res) => {
              resolve(res.statusCode!)
              res.resume()
              req.destroy()
            },
          )
          req.on('error', reject)
          req.flushHeaders()
        })
        assert.equal(status, expected)
      }
      assert.equal(f.app.get(ProbeWork).bodyRead, 0)
      mock.method(runtime.privateLibraries, 'open', (actor: string) => {
        personal = originalOpen(actor)
        opened.resolve()
        return personal
      })
      mock.method(
        runtime.housekeeping,
        'observeRequest',
        (...args: Parameters<typeof originalObserve>) => {
          args[2].sources()
          originalObserve(...args)
          observed.resolve()
        },
      )
      const req = request({
        host: '127.0.0.1',
        port: f.port,
        path: '/api/probe/private',
        method: 'POST',
        headers: {
          Host: f.config.origin.host,
          Origin: f.config.origin.origin,
          Cookie: bob,
          'X-Study-Account': f.sessions.get(bob)!,
          'Content-Type': 'application/json',
          'Content-Length': 100,
        },
      })
      req.on('error', () => {})
      req.write('{')
      await opened.promise
      personal!.sources()
      await f.app.close()
      await observed.promise
      assert.throws(() => personal!.sources(), /closed|not open/)
    } finally {
      await f.close()
    }
  },
)

test('private repositories selected by the verified actor isolate real imported content', async () => {
  const f = await fixture()
  try {
    const alice = await f.login('alice')
    const bob = await f.login('bob')
    const imported = await f.authorized(
      '/api/probe/bank',
      bob,
      'POST',
      { 'Content-Type': 'application/json', 'X-Study-Role': 'admin' },
      JSON.stringify({ bank: bank(), accountId: f.sessions.get(alice) }),
    )
    assert.equal(imported.status, 201)
    assert.equal(JSON.parse((await f.authorized('/api/probe', bob)).body).sources.length, 1)
    assert.deepEqual(JSON.parse((await f.authorized('/api/probe', alice)).body).sources, [])
    assert.deepEqual(f.app.get(ApplicationRuntime).sharedLibrary.sources(), [])
  } finally {
    await f.close()
  }
})

test('failed Nest feature construction releases the runtime acquired by the same graph', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'nest-security-failure-'))
  const config = runtimeConfiguration({ STUDY_DB_PATH: join(directory, 'library.sqlite3') })
  let runtime: ApplicationRuntime | undefined
  try {
    const feature = {
      module: FailureModule,
      providers: [
        {
          provide: 'FailingFeature',
          inject: [ApplicationRuntime],
          useFactory: (value: ApplicationRuntime) => {
            runtime = value
            throw new Error('synthetic-construction-failure')
          },
        },
      ],
    }
    await assert.rejects(createApplication(config, [feature]), /synthetic-construction-failure/)
    assert.ok(runtime)
    assert.throws(() => runtime!.sharedLibrary.sources(), /closed|not open/)
    assert.throws(() => runtime!.authentication.legacyOwnerId('closed'), /closed|not open/)
  } finally {
    await runtime?.onModuleDestroy()
    runtime?.onApplicationShutdown()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('startup owner closes HTTP and roots once after Nest init failure', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'nest-security-init-'))
  const config = runtimeConfiguration({ STUDY_DB_PATH: join(directory, 'library.sqlite3') })
  const feature = {
    module: FailureModule,
    providers: [
      {
        provide: 'FailedInit',
        useValue: {
          onModuleInit() {
            throw new Error('synthetic-init-failure')
          },
        },
      },
    ],
  }
  const app = await createApplication(config, [feature])
  const runtime = app.get(ApplicationRuntime)
  const owner = new ApplicationOwner(Promise.resolve(app))
  const adapter = app.getHttpAdapter()
  const closeHttp = adapter.close.bind(adapter)
  const close = mock.method(adapter, 'close', closeHttp)
  try {
    await assert.rejects(owner.start(0, '127.0.0.1'), /synthetic-init-failure/)
    assert.equal(close.mock.callCount(), 1)
    assert.throws(() => runtime.sharedLibrary.sources(), /closed|not open/)
    assert.throws(() => runtime.authentication.legacyOwnerId('closed'), /closed|not open/)
  } finally {
    await app.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('Nest listen failure releases initialized roots without closing another listener', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'nest-security-listen-'))
  const listener = createServer()
  await new Promise<void>((resolve) => listener.listen(0, '127.0.0.1', resolve))
  const address = listener.address()
  assert.ok(address && typeof address !== 'string')
  const config = runtimeConfiguration({ STUDY_DB_PATH: join(directory, 'library.sqlite3') })
  const app = await createApplication(config)
  const owner = new ApplicationOwner(Promise.resolve(app))
  const runtime = app.get(ApplicationRuntime)
  try {
    await assert.rejects(owner.start(address.port, '127.0.0.1'), /EADDRINUSE/)
    assert.throws(() => runtime.sharedLibrary.sources(), /closed|not open/)
    assert.throws(() => runtime.authentication.legacyOwnerId('closed'), /closed|not open/)
    assert.equal(listener.listening, true)
  } finally {
    await app.close()
    await closeServer(listener)
    rmSync(directory, { recursive: true, force: true })
  }
})

test(
  'shutdown owns an admitted request while later guards are pending before scope acquisition',
  { timeout: 15000 },
  async () => {
    const f = await fixture()
    const entered = deferred()
    const release = deferred()
    const work = f.app.get(ProbeWork)
    work.entered = entered.resolve
    work.release = release.promise
    try {
      const session = await f.login('bob')
      const calling = f.authorized('/api/probe/guard-wait', session).catch(() => undefined)
      await entered.promise
      let closed = false
      const closing = f.app.close().then(() => {
        closed = true
      })
      // Give the complete Nest shutdown sequence an opportunity to finish if it has lost this request.
      for (let i = 0; i < 5; i++) {
        await setImmediate()
      }
      assert.equal(closed, false)
      f.app.get(ApplicationRuntime).sharedLibrary.sources()
      release.resolve()
      await closing
      await calling
    } finally {
      release.resolve()
      await f.close()
    }
  },
)

test('compiled sessions expire and expired browser transactions remain one-shot', async () => {
  const f = await fixture()
  try {
    const session = await f.login('bob')
    f.advance(8 * 60 * 60_000)
    assert.deepEqual(JSON.parse((await f.call('/api/session', 'GET', { Cookie: session })).body), {
      user: null,
    })
    assert.equal((await f.authorized('/api/probe', session)).status, 401)
    const attempt = await f.authorize('bob')
    f.advance(600_000)
    assert.equal((await f.call(attempt.path, 'GET', { Cookie: attempt.cookie })).status, 400)
    assert.equal((await f.call(attempt.path, 'GET', { Cookie: attempt.cookie })).status, 400)
  } finally {
    await f.close()
  }
})

test('raw HTTP retains case/slash/percent rules and original Host checks despite forwarded headers', async () => {
  const f = await fixture()
  try {
    const session = await f.login('bob')
    for (const path of ['/api/Health', '/api/health/', '/api/%68ealth', '/api/probe/item/%FF']) {
      assert.equal((await f.authorized(path, session)).status, 404, path)
    }
    assert.equal(
      (
        await f.call('/api/health', 'GET', {
          Host: 'foreign.example',
          'X-Forwarded-Host': f.config.origin.host,
        })
      ).status,
      403,
    )
    assert.equal((await f.call('/auth/callback', 'HEAD')).status, 404)
    assert.equal((await f.call('/auth/login', 'OPTIONS')).status, 404)
    assert.equal(
      (await f.call('/api/../shell', 'GET', { 'Sec-Fetch-Site': 'cross-site' })).status,
      404,
      'public navigation passes admission but there is no shell yet',
    )
    assert.equal((await f.call('/api/../auth/logout')).status, 404)
    assert.equal((await f.call('http://[malformed')).status, 500)
    assert.equal(
      (await f.authorized(f.config.origin.origin + '/api/probe?value=first&value=second', session))
        .status,
      200,
    )
    const raw = await new Promise<string>((resolve, reject) => {
      const socket = createConnection({ host: '127.0.0.1', port: f.port }, () => {
        socket.end(
          `get /api/health HTTP/1.1\r\nHost: ${f.config.origin.host}\r\nConnection: close\r\n\r\n`,
        )
      })
      let result = ''
      socket.setEncoding('utf8')
      socket.on('data', (chunk) => {
        result += chunk
      })
      socket.on('error', reject)
      socket.on('end', () => resolve(result))
    })
    assert.match(
      raw,
      /^HTTP\/1.1 400 /,
      'Node rejects lowercase methods before either transport handles them',
    )
  } finally {
    await f.close()
  }
})

test(
  'the startup owner joins Nest initialization before disposing roots',
  { timeout: 15000 },
  async () => {
    const directory = mkdtempSync(join(tmpdir(), 'nest-security-start-close-'))
    const config = runtimeConfiguration({ STUDY_DB_PATH: join(directory, 'library.sqlite3') })
    const entered = deferred()
    const release = deferred()
    const feature = {
      module: FailureModule,
      providers: [
        {
          provide: 'DelayedInit',
          useValue: {
            async onModuleInit() {
              entered.resolve()
              await release.promise
            },
          },
        },
      ],
    }
    const app = await createApplication(config, [feature])
    const runtime = app.get(ApplicationRuntime)
    const owner = new ApplicationOwner(Promise.resolve(app))
    const listening = owner.start(0, '127.0.0.1')
    await entered.promise
    let closed = false
    const closing = owner.close().then(() => {
      closed = true
    })
    try {
      for (let i = 0; i < 5; i++) {
        await setImmediate()
      }
      assert.equal(closed, false)
      runtime.sharedLibrary.sources()
      release.resolve()
      await listening
      await closing
      assert.equal((app.getHttpServer() as Server).listening, false)
      assert.throws(() => runtime.sharedLibrary.sources(), /closed|not open/)
    } finally {
      release.resolve()
      await listening.catch(() => undefined)
      await app.close()
      // A failing ownership assertion must still clean this test's late listener.
      const server = app.getHttpServer() as Server
      if (server.listening) {
        await closeServer(server)
      }
      rmSync(directory, { recursive: true, force: true })
    }
  },
)

test('failed startup refuses delayed DI acquisition after another provider has already rejected', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'nest-security-delayed-di-'))
  try {
    const config = runtimeConfiguration({ STUDY_DB_PATH: join(directory, 'library.sqlite3') })
    const startup = new RuntimeStartup()
    await startup.closeFailedStartup()
    await assert.rejects(startup.acquire(config), /already failed/)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

for (const input of ['factory', 'pipe']) {
  test(
    `awaited business work migrated from ${input} retains storage and the shutdown lease`,
    { timeout: 15000 },
    async () => {
      const f = await fixture()
      const entered = deferred()
      const rejected = deferred()
      const release = deferred()
      const work = f.app.get(ProbeWork)
      work.inputEntered = entered.resolve
      work.failureEntered = rejected.resolve
      work.beforeFailure = entered.promise
      work.inputRelease = release.promise
      let calling: Promise<unknown> | undefined
      try {
        const session = await f.login('bob')
        let responded = false
        calling = f.authorized(`/api/probe/input-${input}`, session).then(
          (response) => {
            responded = true
            return response
          },
          () => undefined,
        )
        await rejected.promise
        for (let i = 0; i < 5; i++) {
          await setImmediate()
        }
        assert.equal(work.businessEntries, 1)
        assert.equal(work.businessCompletions, 0)
        assert.equal(responded, false, 'HTTP error waits for awaited non-cancellable business work')
        work.personal!.sources()
        let closed = false
        const closing = f.app.close().then(() => {
          closed = true
        })
        for (let i = 0; i < 5; i++) {
          await setImmediate()
        }
        assert.equal(closed, false)
        work.personal!.sources()
        release.resolve()
        await closing
        await calling
        assert.equal(work.lateRead, true, 'late business DB work completes before storage closes')
        assert.equal(work.businessEntries, 1)
        assert.equal(work.businessCompletions, 1)
        assert.throws(() => work.personal!.sources(), /closed|not open/)
      } finally {
        release.resolve()
        await calling
        await f.close()
      }
    },
  )
}

for (const input of ['factory', 'pipe']) {
  test(
    `awaited business work migrated from ${input} settles before the original 400`,
    { timeout: 15000 },
    async () => {
      const f = await fixture()
      const entered = deferred()
      const rejected = deferred()
      const release = deferred()
      const work = f.app.get(ProbeWork)
      work.inputEntered = entered.resolve
      work.failureEntered = rejected.resolve
      work.beforeFailure = entered.promise
      work.inputRelease = release.promise
      let calling: ReturnType<typeof f.authorized> | undefined
      try {
        const session = await f.login('bob')
        calling = f.authorized(`/api/probe/input-${input}`, session)
        await rejected.promise
        for (let i = 0; i < 5; i++) {
          await setImmediate()
        }
        work.personal!.sources()
        assert.equal(work.businessEntries, 1)
        assert.equal(work.businessCompletions, 0)
        release.resolve()
        const response = await calling
        assert.equal(response.status, 400)
        assert.deepEqual(JSON.parse(response.body), {
          error: 'Synthetic parameter rejection.',
          details: [],
        })
        assert.equal(response.headers['cache-control'], 'no-store')
        assert.equal(response.headers['x-content-type-options'], 'nosniff')
        assert.equal(work.lateRead, true)
        assert.equal(work.businessEntries, 1)
        assert.equal(work.businessCompletions, 1)
        assert.throws(() => work.personal!.sources(), /closed|not open/)
      } finally {
        release.resolve()
        await calling
        await f.close()
      }
    },
  )
}

test(
  'guarded partial JSON cancellation settles before observation and the original 400',
  { timeout: 15000 },
  async () => {
    const f = await fixture()
    const work = f.app.get(ProbeWork)
    const entered = deferred()
    work.bodyEntered = entered.resolve
    work.beforeFailure = entered.promise
    const runtime = f.app.get(ApplicationRuntime)
    const observeRequest = runtime.housekeeping.observeRequest.bind(runtime.housekeeping)
    let observed = false
    const observe = mock.method(
      runtime.housekeeping,
      'observeRequest',
      (...args: Parameters<typeof observeRequest>) => {
        args[2].sources()
        assert.equal(work.bodyRequest!.inputWork!.signal.aborted, true)
        assert.equal(
          work.bodyRequest!.listenerCount('readable'),
          0,
          'cancelled reader removes its pending stream wait before storage closes',
        )
        observeRequest(...args)
        observed = true
      },
    )
    let req: ReturnType<typeof request> | undefined
    try {
      const session = await f.login('bob')
      const response = await new Promise<{
        status: number
        body: string
        headers: import('node:http').IncomingHttpHeaders
      }>((resolve, reject) => {
        req = request(
          {
            host: '127.0.0.1',
            port: f.port,
            path: '/api/probe/input-body',
            method: 'POST',
            headers: {
              Host: f.config.origin.host,
              Origin: f.config.origin.origin,
              Cookie: session,
              'X-Study-Account': f.sessions.get(session)!,
              'Content-Type': 'application/json',
              'Content-Length': 100,
            },
          },
          (res) => {
            let body = ''
            res.on('error', reject)
            res.on('data', (chunk) => {
              body += chunk
            })
            res.on('end', () => resolve({ status: res.statusCode!, body, headers: res.headers }))
          },
        )
        req.on('error', reject)
        req.write('{')
      })
      assert.equal(
        response.status,
        400,
        'partial body is cancelled without waiting for the remaining 99 bytes',
      )
      assert.deepEqual(JSON.parse(response.body), {
        error: 'Synthetic parameter rejection.',
        details: [],
      })
      assert.equal(response.headers['cache-control'], 'no-store')
      assert.equal(response.headers['x-content-type-options'], 'nosniff')
      assert.equal(observed, true)
      assert.equal(work.inputControllerCalls, 0)
      assert.throws(() => work.personal!.sources(), /closed|not open/)
      await f.app.close()
      assert.throws(() => runtime.sharedLibrary.sources(), /closed|not open/)
    } finally {
      req?.destroy()
      observe.mock.restore()
      await f.close()
    }
  },
)

for (const disconnect of [false, true]) {
  test(
    `awaited controller work remains usable through ${disconnect ? 'disconnect' : 'resolution'}`,
    { timeout: 15000 },
    async () => {
      const f = await fixture()
      const work = f.app.get(ProbeWork)
      const entered = deferred()
      const release = deferred()
      work.inputEntered = entered.resolve
      work.inputRelease = release.promise
      let req: ReturnType<typeof request> | undefined
      let calling: Promise<{ status: number; body: string } | undefined> | undefined
      try {
        const session = await f.login('bob')
        calling = new Promise<{ status: number; body: string }>((resolve, reject) => {
          req = request(
            {
              host: '127.0.0.1',
              port: f.port,
              path: '/api/probe/input-success',
              headers: {
                Host: f.config.origin.host,
                Origin: f.config.origin.origin,
                Cookie: session,
                'X-Study-Account': f.sessions.get(session)!,
              },
            },
            (res) => {
              let body = ''
              res.on('data', (chunk) => {
                body += chunk
              })
              res.on('error', reject)
              res.on('end', () => resolve({ status: res.statusCode!, body }))
            },
          )
          req.on('error', reject)
          req.end()
        }).catch(() => undefined)
        await entered.promise
        if (disconnect) {
          req!.destroy()
        }
        work.personal!.sources()
        release.resolve()
        const response = await calling
        if (!disconnect) {
          assert.equal(response!.status, 200)
          assert.deepEqual(JSON.parse(response!.body), { value: 'resolved' })
        }
        await f.app.close()
        assert.equal(work.lateRead, true)
        assert.throws(() => work.personal!.sources(), /closed|not open/)
      } finally {
        release.resolve()
        req?.destroy()
        await calling
        await f.close()
      }
    },
  )
}

for (const [feature, path, method] of [
  [UnownedBodyModule, 'unowned-input', 'POST'],
  [UnownedPipeModule, 'unowned-pipe', 'GET'],
  [UnownedClassPipeModule, 'unowned-class-pipe', 'GET'],
] as const) {
  test(`native input composition ${feature.name} accepts ordinary Nest metadata`, async () => {
    const f = await fixture(undefined, [feature])
    try {
      const session = await f.login('bob')
      const response = await f.authorized(`/api/${path}`, session, method)
      assert.equal(response.status, feature === UnownedBodyModule ? 201 : 200)
    } finally {
      await f.close()
    }
  })
}

test('JSON body parameters outside the registered personal scope fail without reading the body', async () => {
  const f = await fixture(undefined, [UnscopedBodyModule])
  try {
    const session = await f.login('bob')
    const response = await f.authorized(
      '/api/unscoped-body',
      session,
      'POST',
      { 'Content-Type': 'application/json' },
      '{',
    )
    assert.equal(response.status, 500)
    assert.deepEqual(JSON.parse(response.body), {
      error: 'The local operation failed. No partial import was saved.',
    })
  } finally {
    await f.close()
  }
})

test('pre-init global and injected APP_PIPE transform native Body and Param inputs after guards', async () => {
  const calls: Array<{ label: string; type: string }> = []

  const pipe = (label: string) => ({
    transform(value: unknown, metadata: ArgumentMetadata) {
      if (metadata.type !== 'body' && metadata.type !== 'param') {
        return value
      }
      calls.push({ label, type: metadata.type })
      return `${String(value)}|${label}`
    },
  })

  const label = Symbol('GlobalPipeLabel')
  const feature = {
    module: FailureModule,
    providers: [
      { provide: label, useValue: 'injected' },
      { provide: APP_PIPE, inject: [label], useFactory: (value: string) => pipe(value) },
    ],
  }
  const f = await fixture(undefined, [feature], (app) => {
    assert.equal(app.useGlobalPipes(pipe('global')), app)
  })
  try {
    const path = '/api/probe/pipeline/item'
    const headers = { 'Content-Type': 'application/json' }
    assert.equal((await f.call(path, 'POST', headers, 'INVALID')).status, 401)
    assert.equal(calls.length, 0, 'Guards reject before native input validation')
    const session = await f.login('bob')
    calls.length = 0
    assert.equal((await f.authorized(path, session, 'POST', headers, 'INVALID')).status, 400)
    assert.equal(calls.length, 0, 'The guarded reader finishes before native pipes')
    const response = await f.authorized(
      path,
      session,
      'POST',
      headers,
      JSON.stringify({ value: 'body' }),
    )
    assert.equal(response.status, 200)
    assert.deepEqual(JSON.parse(response.body), {
      value: 'body|injected|global',
      id: 'item|injected|global',
    })
    for (const type of ['body', 'param']) {
      assert.deepEqual(
        calls.filter((call) => call.type === type).map((call) => call.label),
        ['injected', 'global'],
      )
    }
  } finally {
    await f.close()
  }
})

test('owned ordinary Nest custom parameters preserve data, metatype and ordered asynchronous instance pipes', async () => {
  const f = await fixture()
  try {
    const session = await f.login('bob')
    const response = await f.authorized('/api/probe/input-metadata', session)
    assert.equal(response.status, 200)
    assert.deepEqual(JSON.parse(response.body), {
      value: 'selection',
      data: 'selection',
      type: 'custom',
      metatype: 'String',
      order: ['first', 'second'],
    })
  } finally {
    await f.close()
  }
})

test(
  'a disconnect during a later guard cancels inputs before the personal scope takes ownership',
  { timeout: 15000 },
  async () => {
    const f = await fixture()
    const entered = deferred()
    const disconnected = deferred()
    const release = deferred()
    const scoped = deferred()
    const work = f.app.get(ProbeWork)
    work.entered = entered.resolve
    work.guardClosed = disconnected.resolve
    work.release = release.promise
    const scope = f.app.get(StudyLibraryScope)
    const withLibrary = scope.withLibrary.bind(scope)
    let personal: LibraryRepository | undefined
    const capture = mock.method(
      scope,
      'withLibrary',
      <T>(
        actor: SessionUser,
        method: string | undefined,
        run: (library: LibraryRepository) => Promise<T>,
      ): Promise<T> =>
        withLibrary(actor, method, (library) => {
          personal = library
          const operation = run(library)
          scoped.resolve()
          return operation
        }),
    )
    let req: ReturnType<typeof request> | undefined
    let calling: Promise<void> | undefined
    try {
      const session = await f.login('bob')
      calling = new Promise<void>((resolve) => {
        req = request({
          host: '127.0.0.1',
          port: f.port,
          path: '/api/probe/guard-cooperative',
          headers: {
            Host: f.config.origin.host,
            Origin: f.config.origin.origin,
            Cookie: session,
            'X-Study-Account': f.sessions.get(session)!,
          },
        })
        req.on('error', () => resolve())
        req.end()
      })
      await entered.promise
      req!.destroy()
      await disconnected.promise
      assert.equal(work.guardRequest!.aborted, true)
      release.resolve()
      await scoped.promise
      assert.equal(
        work.guardRequest!.inputWork!.signal.aborted,
        true,
        'scope admission must reconcile a disconnect already acknowledged by the guard',
      )
      await f.app.close()
      await calling
      assert.equal(work.inputControllerCalls, 0)
      assert.throws(() => personal!.sources(), /closed|not open/)
      const runtime = f.app.get(ApplicationRuntime)
      assert.throws(() => runtime.sharedLibrary.sources(), /closed|not open/)
      assert.throws(() => runtime.authentication.legacyOwnerId('closed'), /closed|not open/)
    } finally {
      release.resolve()
      // Release a broken baseline's cooperative input so a failing regression still cleans up.
      work.guardRequest?.inputWork?.cancel(new Error('Test cleanup.'))
      req?.destroy()
      await calling
      await f.close()
      capture.mock.restore()
    }
  },
)

for (const reverse of [false, true]) {
  test(`inherited local pipes use concrete handler metadata across compositions (reverse=${reverse})`, async () => {
    const feature = inheritedInputModule(reverse)
    const native = await NestFactory.create(feature, { logger: false })
    let expected: unknown[]
    try {
      await native.listen(0, '127.0.0.1')
      const address = (native.getHttpServer() as Server).address()
      assert.ok(address && typeof address !== 'string')
      expected = await Promise.all(
        ['base', 'derived'].map(async (name) => {
          const response = await fetch(`http://127.0.0.1:${address.port}/api/inherited-${name}`)
          assert.equal(response.status, 200)
          return response.json()
        }),
      )
      assert.deepEqual(
        expected.map((value) => (value as { metatype: string }).metatype),
        ['Object', 'String'],
      )
    } finally {
      await native.close()
    }
    for (let composition = 0; composition < 2; composition++) {
      const f = await fixture(undefined, [feature])
      try {
        const session = await f.login('bob')
        const actual = []
        for (const name of ['base', 'derived']) {
          const response = await f.authorized(`/api/inherited-${name}`, session)
          assert.equal(response.status, 200)
          actual.push(JSON.parse(response.body))
        }
        assert.deepEqual(
          actual,
          expected,
          `composition ${composition} must match native Nest exactly`,
        )
      } finally {
        await f.close()
      }
    }
  })
}

test('standard Nest HTTP exceptions retain status and sanitized JSON without losing request ownership', async () => {
  const f = await fixture()
  try {
    const session = await f.login('alice')
    for (const [status, message] of [
      [401, 'Unauthorized'],
      [403, 'Forbidden'],
      [409, 'Conflict'],
      [500, 'The local operation failed. No partial import was saved.'],
      [503, 'The local operation failed. No partial import was saved.'],
    ] as const) {
      const response = await f.authorized(`/api/probe/http-error/${status}`, session)
      assert.equal(response.status, status)
      assert.equal(JSON.parse(response.body).error, message)
      assert.equal(response.body.includes('sensitive'), false)
      assert.equal(response.body.includes('token'), false)
      assert.equal(response.headers['content-type'], 'application/json')
      assert.equal(response.headers['cache-control'], 'no-store')
      assert.equal(response.headers['x-content-type-options'], 'nosniff')
      assert.equal((await f.authorized('/api/probe', session)).status, 200)
    }
  } finally {
    await f.close()
  }
})
