import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { OwnerAuthentication } from '../src/server/auth/owner-authentication.ts'
import { apiController } from '../src/server/http-controller.ts'
import { LibraryRepository } from '../src/server/questions/library-repository.ts'
import { ImportService } from '../src/server/importer/import-service.ts'
import { bank } from './fixtures.ts'
import { closeServer, oidcFixture } from './oidc-fixture.ts'
import { BrowserCookies } from './support/browser-cookies.ts'
import { QuizService } from '../src/server/quizzes/quiz-service.ts'

/** Exercise authentication in front of the unchanged single-library API. */
async function fixture(ownerSubject = 'alice', issuerPath = '/realms/test') {
  const provider = await oidcFixture(issuerPath)
  const directory = mkdtempSync(join(tmpdir(), 'study-owner-login-'))
  const library = new LibraryRepository(join(directory, 'library.sqlite3'))
  const importer = new ImportService(library)
  const input = bank()
  input.questions = Array.from({ length: 20 }, (_, index) => ({
    ...structuredClone(input.questions[0]!),
    source_ref: String(index),
    question: `Synthetic owner question ${index}?`,
  }))
  importer.confirm(input, importer.preview(input).token, false)
  let authentication: OwnerAuthentication
  let now = Date.now()
  const server = createServer((request, response) => {
    void authentication.handle(request, response).then((handled) => {
      if (!handled) {
        if (request.url?.startsWith('/api/')) {
          void api(request, response)
        } else {
          response.writeHead(200, { 'Content-Type': 'text/html' })
          response.end('<!doctype html><title>Study workspace</title>')
        }
      }
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const origin = new URL(`http://127.0.0.1:${address.port}`)
  const options = {
    issuer: provider.issuerIdentifier,
    origin,
    clientId: 'study-tool',
    accountsPath: join(directory, 'accounts.sqlite3'),
    ownerSubject,
    now: () => now,
  }
  authentication = new OwnerAuthentication(options)
  const api = apiController(library, origin)
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
    login,
    authorize,
    provider,
    directory,
    library,
    origin,
    advance: (ms: number) => {
      now += ms
    },
    restart: (subject = ownerSubject) => {
      authentication.close()
      authentication = new OwnerAuthentication({ ...options, ownerSubject: subject })
    },
    close: async () => {
      await closeServer(server)
      authentication.close()
      library.close()
      await closeServer(provider.server)
      rmSync(directory, { recursive: true, force: true })
    },
  }
}

test('a verified non-owner cannot establish an application session', async () => {
  const app = await fixture()
  try {
    const denied = await app.login('bob')
    assert.equal(denied.response.status, 403)
    assert.equal(denied.cookie, '')
    const session = await app.call('/api/session', denied.cookie)
    assert.deepEqual(await session.json(), { user: null })
  } finally {
    await app.close()
  }
})

test('a root issuer without a trailing slash admits the owner and survives restart', async () => {
  const app = await fixture('alice', '')
  try {
    const owner = await app.login('alice')
    assert.equal(owner.response.status, 302)
    app.restart()
    assert.equal((await app.call('/api/questions', owner.cookie)).status, 200)
  } finally {
    await app.close()
  }
})

test('owner login uses the existing library and history without creating private databases', async () => {
  const app = await fixture()
  try {
    const service = new QuizService(app.library)
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
    assert.equal((await app.call('/api/questions')).status, 401)
    const owner = await app.login('alice')
    assert.equal(owner.response.status, 302)
    const library = await app.call('/api/questions', owner.cookie)
    assert.equal((await library.json()).total, 20)
    const history = await app.call(
      '/api/quizzes?provider=Example&certification=DEMO-1',
      owner.cookie,
    )
    assert.equal((await history.json()).length, 1)
    assert.equal(existsSync(join(app.directory, 'users')), false)
    assert.equal(app.library.allQuestions().length, 20)
  } finally {
    await app.close()
  }
})

test('sessions survive an auth restart, expire at eight hours and follow configured owner changes', async () => {
  const app = await fixture()
  try {
    const owner = await app.login('alice')
    app.restart()
    assert.equal((await app.call('/api/questions', owner.cookie)).status, 200)
    app.advance(8 * 60 * 60_000)
    assert.equal((await app.call('/api/questions', owner.cookie)).status, 401)
    const replacement = await app.login('alice')
    app.restart('bob')
    assert.equal((await app.call('/api/questions', replacement.cookie)).status, 401)
    assert.equal((await app.login('alice')).response.status, 403)
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

test('verified non-owner sign-in revokes an existing browser owner session', async () => {
  const app = await fixture()
  try {
    const owner = await app.login('alice')
    const denied = await app.login('bob', owner.cookie)
    assert.equal(denied.response.status, 403)
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

test('an explicit owner is required before authentication storage is created', () => {
  const directory = mkdtempSync(join(tmpdir(), 'study-owner-config-'))
  try {
    const accountsPath = join(directory, 'accounts.sqlite3')
    const options = {
      issuer: 'http://127.0.0.1:8080/realms/study',
      origin: new URL('http://127.0.0.1:3000'),
      clientId: 'study-tool',
      ownerSubject: '',
      accountsPath,
    }
    assert.throws(() => new OwnerAuthentication(options), /STUDY_OWNER_SUBJECT/)
    assert.equal(existsSync(accountsPath), false)
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
