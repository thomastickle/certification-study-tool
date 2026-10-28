import { createProductionApplication } from '../../src/server/production-application.ts'
import { ApplicationRuntime } from '../../src/server/application-runtime.ts'
import { runtimeConfiguration } from '../../src/server/runtime-configuration.ts'
import type { RequestUrl } from '../../src/server/request-url.ts'
import type { SessionUser } from '../../src/shared/auth-contracts.ts'

import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { request as httpRequest } from 'node:http'
import type { IncomingMessage } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mock, test } from 'node:test'
import { ApplicationAuthentication } from '../../src/server/auth/application-authentication.ts'
import { ImportService } from '../../src/server/importer/import-service.ts'
import { bank } from '../fixtures.ts'
import { closeServer, oidcFixture } from '../oidc-fixture.ts'
import { BrowserCookies } from '../support/browser-cookies.ts'
import { QuizService } from '../../src/server/quizzes/quiz-service.ts'

type AdmittedStudy = { route: 'study'; url: RequestUrl; user: SessionUser }

/** Exercise verified identities and role checks in front of the shared-content/private-study API. */
async function fixture(
  issuerPath = '/realms/test',
  afterAuthentication?: (request: IncomingMessage, context: AdmittedStudy) => void,
) {
  const administrators = new Set(['alice', 'charlie'])
  const provider = await oidcFixture(issuerPath, (subject) => ({
    study_roles: administrators.has(subject) ? ['admin'] : [],
  }))
  const directory = mkdtempSync(join(tmpdir(), 'study-owner-login-'))
  writeFileSync(join(directory, 'index.html'), '<!doctype html><title>Study workspace</title>')
  const configuration = runtimeConfiguration({
    STUDY_DB_PATH: join(directory, 'library.sqlite3'),
    STUDY_OIDC_ISSUER: provider.issuerIdentifier,
    NODE_ENV: 'production',
  })
  configuration.staticRoot = directory
  let now = Date.now()
  configuration.authentication.now = () => now
  let app = await createProductionApplication(configuration)
  let runtime = app.get(ApplicationRuntime)
  const library = runtime.sharedLibrary
  const importer = new ImportService(library)
  const input = bank()
  input.questions = Array.from({ length: 20 }, (_, index) => ({
    ...structuredClone(input.questions[0]!),
    source_ref: String(index),
    question: `Synthetic owner question ${index}?`,
  }))
  importer.confirm(input, importer.preview(input).token, false)
  const origin = configuration.origin

  /** Observe actual admission, then perturb the raw target before the Nest adapter restores it. */
  function observeAdmission() {
    const authentication = app.get(ApplicationAuthentication)
    const admit = authentication.admit.bind(authentication)
    return mock.method(authentication, 'admit', (request: IncomingMessage) => {
      const url = admit(request)
      if (afterAuthentication && url.pathname.endsWith('/questions')) {
        afterAuthentication(request, {
          route: 'study',
          url,
          user: authentication.session(request)!,
        })
      }
      return url
    })
  }

  let observation = observeAdmission()
  await app.listen(0, '127.0.0.1')
  const address = (app.getHttpServer() as import('node:http').Server).address()
  assert.ok(address && typeof address !== 'string')
  origin.port = String(address.port)
  const accounts = new Map<string, string>()

  const call = (path: string, cookie = '', init: RequestInit = {}) => {
    const headers = {
      Origin: origin.origin,
      Cookie: cookie,
      'X-Study-Account': accounts.get(cookie) ?? '',
      ...init.headers,
    }
    return fetch(new URL(path, origin), { ...init, headers, redirect: 'manual' })
  }

  /** Read a successful JSON response after checking the transport outcome. */
  async function json(path: string, cookie: string, init: RequestInit = {}) {
    const response = await call(path, cookie, init)
    assert.equal(response.ok, true, `Unexpected HTTP ${response.status} for ${path}`)
    return response.json()
  }

  async function authorize(subject: string) {
    const start = await call('/auth/login')
    assert.equal(start.status, 302)
    const cookie = start.headers.getSetCookie()[0]!.split(';')[0]!
    const url = new URL(start.headers.get('location')!)
    url.searchParams.set('user', subject)
    const authorized = await fetch(url, { redirect: 'manual' })
    const callback = new URL(authorized.headers.get('location')!)
    return { callback: callback.pathname + callback.search, cookie }
  }

  async function login(subject: string, previousSession = '') {
    const attempt = await authorize(subject)
    const cookies = [attempt.cookie, previousSession].filter(Boolean).join('; ')
    const response = await call(attempt.callback, cookies)
    const cookie = response.headers
      .getSetCookie()
      .find((value) => value.startsWith('study_session=') && !value.includes('Max-Age=0'))
    const sessionCookie = cookie?.split(';')[0] ?? ''
    if (response.status === 302) {
      const session = await call('/api/session', sessionCookie)
      accounts.set(sessionCookie, (await session.json()).user.id)
    }
    return { response, cookie: sessionCookie }
  }

  return {
    call,
    rawCall: (path: string, cookie = '', account = accounts.get(cookie) ?? '') =>
      new Promise<{ status: number; body: string }>((resolve, reject) => {
        const request = httpRequest(
          origin,
          {
            path,
            headers: { Cookie: cookie, 'X-Study-Account': account },
          },
          (response) => {
            let body = ''
            response.setEncoding('utf8')
            response.on('data', (chunk) => {
              body += chunk
            })
            response.on('end', () => resolve({ status: response.statusCode!, body }))
          },
        )
        request.on('error', reject)
        request.end()
      }),
    json,
    login,
    authorize,
    provider,
    directory,
    get library() {
      return runtime.sharedLibrary
    },
    get privateLibraries() {
      return runtime.privateLibraries
    },
    origin,
    setAdmin: (subject: string, admin: boolean) => {
      if (admin) {
        administrators.add(subject)
      } else {
        administrators.delete(subject)
      }
    },
    advance: (ms: number) => {
      now += ms
    },
    restart: async (issuer = provider.issuerIdentifier) => {
      observation.mock.restore()
      await app.close()
      configuration.authentication.issuer = issuer
      app = await createProductionApplication(configuration)
      runtime = app.get(ApplicationRuntime)
      observation = observeAdmission()
      await app.listen(0, '127.0.0.1')
      const address = (app.getHttpServer() as import('node:http').Server).address()
      assert.ok(address && typeof address !== 'string')
      origin.port = String(address.port)
    },
    close: async () => {
      observation.mock.restore()
      await app.close()
      await closeServer(provider.server)
      rmSync(directory, { recursive: true, force: true })
    },
  }
}

test('verified users share question banks while keeping attempts and mutation permissions private', async () => {
  const app = await fixture()
  try {
    const alice = await app.login('alice')
    const bob = await app.login('bob')
    assert.equal(alice.response.status, 302)
    assert.equal(bob.response.status, 302)
    assert.equal((await app.json('/api/questions', bob.cookie)).total, 20)
    assert.equal((await app.json('/api/session', alice.cookie)).user.role, 'admin')
    assert.equal((await app.json('/api/session', bob.cookie)).user.role, 'student')
    const started = await app.call('/api/quizzes', alice.cookie, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: 'Example',
        certification: 'DEMO-1',
        sourceFilter: 'mixed',
        questionType: 'mixed',
      }),
    })
    assert.equal(started.status, 201)
    const quiz = await started.json()
    assert.equal((await app.call(`/api/quizzes/${quiz.id}`, bob.cookie)).status, 404)
    assert.equal(
      (await app.call(`/api/quizzes/${quiz.id}/pause`, bob.cookie, { method: 'POST' })).status,
      404,
    )
    const question = app.library.allQuestions()[0]!
    assert.equal(
      (await app.call(`/api/questions/${question.id}`, bob.cookie, { method: 'DELETE' })).status,
      403,
    )
    assert.equal(
      (await app.call(`/api/questions/${question.id}`, alice.cookie, { method: 'DELETE' })).status,
      204,
    )
  } finally {
    await app.close()
  }
})

test('import previews cannot be confirmed by another admin or replayed after confirmation', async () => {
  const app = await fixture()
  try {
    const alice = await app.login('alice')
    const charlie = await app.login('charlie')
    const student = await app.login('bob')
    const input = bank('another-shared-bank')
    const options = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bank: input }),
    }
    assert.equal((await app.call('/api/imports/preview', student.cookie, options)).status, 403)
    const preview = await app.json('/api/imports/preview', alice.cookie, options)
    const confirmation = {
      ...options,
      body: JSON.stringify({ bank: input, token: preview.token, reviewed: true }),
    }
    assert.equal((await app.call('/api/imports/confirm', charlie.cookie, confirmation)).status, 409)
    assert.equal((await app.call('/api/imports/confirm', alice.cookie, confirmation)).status, 201)
    assert.equal((await app.call('/api/imports/confirm', alice.cookie, confirmation)).status, 409)
  } finally {
    await app.close()
  }
})

test('a fresh login replaces the browser session with its newly verified role', async () => {
  const app = await fixture()
  try {
    const first = await app.login('alice')
    app.setAdmin('alice', false)
    const changed = await app.login('alice', first.cookie)
    assert.equal(changed.response.status, 302)
    const session = await app.json('/api/session', changed.cookie)
    assert.equal(session.user.role, 'student')
    assert.equal((await app.call('/api/questions', first.cookie)).status, 401)
    assert.equal((await app.call('/api/questions', changed.cookie)).status, 200)
    const question = app.library.allQuestions()[0]!
    assert.equal(
      (await app.call(`/api/questions/${question.id}`, changed.cookie, { method: 'DELETE' }))
        .status,
      403,
    )
    await app.restart()
    assert.equal((await app.json('/api/session', changed.cookie)).user.role, 'student')
  } finally {
    await app.close()
  }
})

test('students cannot mutate shared namespaces by forging a browser role or payload identity', async () => {
  const app = await fixture()
  try {
    const alice = await app.login('alice')
    const bob = await app.login('bob')
    const session = await app.json('/api/session', alice.cookie)
    const question = app.library.allQuestions()[0]!
    const paths = [
      ['POST', '/api/imports/preview'],
      ['POST', '/api/imports/confirm'],
      ['DELETE', `/api/questions/${question.id}`],
      ['DELETE', `/api/sources/${question.sourceId}`],
      ['POST', '/api/concepts'],
      ['PUT', '/api/concepts/11111111-1111-4111-8111-111111111111'],
      ['DELETE', '/api/concepts/11111111-1111-4111-8111-111111111111'],
      ['POST', '/api/concept-suggestions/' + 'a'.repeat(64) + '/dismiss'],
    ] as const
    for (const [method, path] of paths) {
      const options = {
        method,
        headers: { 'Content-Type': 'application/json', 'X-Study-Role': 'admin' },
        body: JSON.stringify({ role: 'admin', accountId: session.user.id, bank: bank() }),
      }
      const denied = await app.call(path, bob.cookie, options)
      assert.equal(denied.status, 403, `${method} ${path} must enforce the session role`)
    }
    assert.equal(app.library.allQuestions().length, 20)
    const earned = await app.call('/api/certifications/earned', bob.cookie, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: 'Example',
        code: 'DEMO-1',
        earned: true,
        accountId: session.user.id,
      }),
    })
    assert.equal(earned.status, 200)
    const bobHome = await app.json('/api/home', bob.cookie)
    const aliceHome = await app.json('/api/home', alice.cookie)
    assert.equal(bobHome.providers[0].certifications[0].earned, true)
    assert.equal(aliceHome.providers[0].certifications[0].earned, false)
  } finally {
    await app.close()
  }
})

test('a root issuer without a trailing slash admits the owner and survives restart', async () => {
  const app = await fixture('')
  try {
    const owner = await app.login('alice')
    assert.equal(owner.response.status, 302)
    await app.restart()
    assert.equal((await app.call('/api/questions', owner.cookie)).status, 200)
  } finally {
    await app.close()
  }
})

test('shared content and personal history do not require a database copy per user', async () => {
  const app = await fixture()
  try {
    const owner = await app.login('alice')
    const user = (await app.json('/api/session', owner.cookie)).user
    const personal = app.privateLibraries.open(user.id)
    const service = new QuizService(app.library.forAccount(user.id, personal))
    const quiz = service.start({
      provider: 'Example',
      certification: 'DEMO-1',
      sourceFilter: 'mixed',
      questionType: 'mixed',
    })
    const answers = quiz.questions.map((question) => ({
      questionId: question.questionId,
      selected: [],
      confidence: 'Unsure',
      flagged: false,
    }))
    service.submit(quiz.id, { answers })
    personal.close()
    assert.equal((await app.call('/api/questions')).status, 401)
    assert.equal(owner.response.status, 302)
    const library = await app.call('/api/questions', owner.cookie)
    assert.equal((await library.json()).total, 20)
    const history = await app.call(
      '/api/quizzes?provider=Example&certification=DEMO-1',
      owner.cookie,
    )
    assert.equal((await history.json()).length, 1)
    assert.equal(existsSync(join(app.directory, 'users', `${user.id}.sqlite3`)), true)
    assert.deepEqual(app.library.forAccount(user.id).quizStore().snapshots(), [])
    assert.equal(app.library.allQuestions().length, 20)
  } finally {
    await app.close()
  }
})

test('sessions survive restart, expire at eight hours and reject a changed issuer', async () => {
  const app = await fixture()
  try {
    const owner = await app.login('alice')
    await app.restart()
    assert.equal((await app.call('/api/questions', owner.cookie)).status, 200)
    app.advance(8 * 60 * 60_000)
    assert.equal((await app.call('/api/questions', owner.cookie)).status, 401)
    const replacement = await app.login('alice')
    await app.restart('https://other.example/realm')
    assert.equal((await app.call('/api/questions', replacement.cookie)).status, 401)
    await app.restart()
    const bob = await app.login('bob')
    assert.equal((await app.call('/api/questions', bob.cookie)).status, 200)
  } finally {
    await app.close()
  }
})

test('logout requires a same-origin POST and revokes the durable session', async () => {
  const app = await fixture()
  try {
    const owner = await app.login('alice')
    assert.equal((await app.call('/auth/logout', owner.cookie)).status, 404)
    const crossSite = await app.call('/auth/logout', owner.cookie, {
      method: 'POST',
      headers: { Origin: 'https://foreign.example' },
    })
    assert.equal(crossSite.status, 403)
    assert.equal((await app.call('/api/questions', owner.cookie)).status, 200)
    const logout = await app.call('/auth/logout', owner.cookie, { method: 'POST' })
    assert.equal(logout.status, 303)
    assert.match(logout.headers.getSetCookie()[0]!, /Max-Age=0/)
    assert.equal((await app.call('/api/questions', owner.cookie)).status, 401)
  } finally {
    await app.close()
  }
})

test('switching accounts revokes the prior browser session', async () => {
  const app = await fixture()
  try {
    const owner = await app.login('alice')
    const replacement = await app.login('bob', owner.cookie)
    assert.equal(replacement.response.status, 302)
    assert.equal((await app.call('/api/questions', owner.cookie)).status, 401)
  } finally {
    await app.close()
  }
})

test('callbacks are single-use, expire, and permit the provider redirect chain only for public navigation', async () => {
  const app = await fixture()
  try {
    const attempt = await app.authorize('alice')
    const callback = await app.call(attempt.callback, attempt.cookie, {
      headers: { 'Sec-Fetch-Site': 'cross-site' },
    })
    assert.equal(callback.status, 302)
    assert.equal(
      (await app.call('/', '', { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status,
      200,
    )
    assert.equal((await app.call(attempt.callback, attempt.cookie)).status, 400)
    const expired = await app.authorize('alice')
    app.advance(600_000)
    assert.equal((await app.call(expired.callback, expired.cookie)).status, 400)
    assert.equal(
      (await app.call('/api/session', '', { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status,
      403,
    )
  } finally {
    await app.close()
  }
})

test('a browser can restart login 1001 times without exhausting pending capacity', async () => {
  const app = await fixture()
  const jar = new BrowserCookies()
  try {
    let authorization = ''
    for (let index = 0; index < 1001; index++) {
      const response = await app.call('/auth/login', jar.header('/auth/login'))
      assert.equal(response.status, 302)
      jar.accept(response)
      authorization = response.headers.get('location')!
    }
    const authorized = await fetch(authorization, { redirect: 'manual' })
    const callback = new URL(authorized.headers.get('location')!)
    const response = await app.call(
      callback.pathname + callback.search,
      jar.header('/auth/callback'),
    )
    assert.equal(response.status, 302)
    jar.accept(response)
    const session = await app.call('/api/session', jar.header('/api/session'))
    assert.ok((await session.json()).user)
    assert.equal(jar.header('/auth/callback').includes('study_login='), false)
  } finally {
    await app.close()
  }
})

test('multi-user authentication does not provision study databases or require an owner', () => {
  const directory = mkdtempSync(join(tmpdir(), 'study-auth-config-'))
  try {
    const authentication = new ApplicationAuthentication({
      issuer: 'http://127.0.0.1:8080/realms/study',
      origin: new URL('http://127.0.0.1:3000'),
      clientId: 'study-tool',
      accountsPath: join(directory, 'accounts.sqlite3'),
    })
    authentication.close()
    assert.equal(existsSync(join(directory, 'library.sqlite3')), false)
    assert.equal(existsSync(join(directory, 'users')), false)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('stale account bindings are rejected before study mutations', async () => {
  const app = await fixture()
  try {
    const owner = await app.login('alice')
    const question = app.library.allQuestions()[0]!
    const response = await app.call(`/api/questions/${question.id}`, owner.cookie, {
      method: 'DELETE',
      headers: { 'X-Study-Account': 'stale-owner-binding' },
    })
    assert.equal(response.status, 409)
    assert.equal(app.library.allQuestions().length, 20)
  } finally {
    await app.close()
  }
})

test('provider validation failure clears transaction cookies and exposes no token details', async () => {
  const app = await fixture()
  try {
    app.provider.invalidate('signature')
    const result = await app.login('alice')
    assert.equal(result.response.status, 400)
    assert.equal(result.cookie, '')
    const error = await result.response.json()
    assert.deepEqual(error, { error: 'Sign-in could not be verified. Start sign-in again.' })
    const cookies = result.response.headers.getSetCookie()
    assert.ok(
      cookies.some((cookie) => cookie.includes('Path=/auth;') && cookie.includes('Max-Age=0')),
    )
    assert.ok(
      cookies.some(
        (cookie) => cookie.includes('Path=/auth/callback;') && cookie.includes('Max-Age=0'),
      ),
    )
  } finally {
    await app.close()
  }
})

test('validated context preserves query and namespace while downstream ignores a changed raw target', async () => {
  const admitted: AdmittedStudy[] = []
  const app = await fixture('/realms/test', (request, context) => {
    if (context.route === 'study') {
      admitted.push(context)
      request.url = '/public-shell?provider=wrong'
    }
  })
  try {
    const alice = await app.login('alice')
    for (const prefix of ['', '/shared', '/private']) {
      const target = `/api${prefix}/questions?search=Synthetic+owner&page=1&search=missing`
      const response = await app.rawCall(target, alice.cookie)
      assert.equal(response.status, 200)
      assert.equal(JSON.parse(response.body).total, prefix === '/private' ? 0 : 20)
      const context = admitted.at(-1)!
      assert.ok(context.route === 'study')
      assert.deepEqual(context.url, {
        pathname: `/api${prefix}/questions`,
        search: '?search=Synthetic+owner&page=1&search=missing',
      })
      assert.equal(Object.isFrozen(context.url), true)
    }
  } finally {
    await app.close()
  }
})

test('raw normalized request targets retain authentication, workspace and query outcomes', async () => {
  const app = await fixture()
  try {
    const alice = await app.login('alice')
    for (const target of [
      '/public/../api/shared/questions?search=missing',
      '/public/%2e%2e/api/shared/questions?search=missing',
      '/api/private/%2e%2e/shared/questions?search=missing',
      `${app.origin.origin}/api/shared/questions?search=missing`,
    ]) {
      assert.equal((await app.rawCall(target)).status, 401)
      assert.equal((await app.rawCall(target, alice.cookie, 'stale')).status, 409)
      const response = await app.rawCall(target, alice.cookie)
      assert.equal(response.status, 200)
      assert.equal(JSON.parse(response.body).total, 0)
    }
    assert.equal(
      (await app.rawCall('http://foreign.example/api/questions', alice.cookie)).status,
      403,
    )
    assert.equal((await app.rawCall('http://[malformed')).status, 500)
    assert.equal((await app.rawCall('/api/health')).status, 200)
    app.advance(8 * 60 * 60_000)
    assert.equal((await app.rawCall('/public/%2e%2e/api/questions', alice.cookie)).status, 401)
  } finally {
    await app.close()
  }
})
