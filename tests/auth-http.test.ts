import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { StudyApplication } from '../src/server/auth/study-application.ts'
import { closeServer, oidcFixture } from './oidc-fixture.ts'
import { bank } from './fixtures.ts'

/** Use the real HTTP, OIDC, account registry, and study repositories together. */
async function applicationFixture(secure = false) {
  const identity = await oidcFixture()
  const directory = mkdtempSync(join(tmpdir(), 'study-auth-http-'))
  let now = Date.now()
  const server = createServer((request, response) => {
    void app.handle(request, response).then((handled) => {
      if (!handled) {
        response.writeHead(200, { 'Content-Type': 'text/html' })
        response.end('<!doctype html><title>Workspace</title>')
      }
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const base = `http://127.0.0.1:${address.port}`
  const origin = new URL(secure ? base.replace('http:', 'https:') : base)
  const legacyPath = join(directory, 'library.sqlite3')
  writeFileSync(legacyPath, 'untouched legacy database sentinel')
  const app = new StudyApplication({
    issuer: identity.issuer,
    clientId: 'study-tool',
    origin,
    dataDirectory: directory,
    now: () => now,
  })
  const accounts = new Map<string, string>()

  const call = (path: string, cookie = '', options: RequestInit = {}) =>
    fetch(base + path, {
      ...options,
      redirect: 'manual',
      headers: {
        Origin: origin.origin,
        Cookie: cookie,
        'X-Study-Account': accounts.get(cookie) ?? '',
        ...options.headers,
      },
    })

  const login = async (user: string) => {
    const start = await call('/auth/login')
    assert.equal(start.status, 302)
    const loginCookie = start.headers.getSetCookie()[0]!.split(';')[0]!
    const authorize = new URL(start.headers.get('location')!)
    authorize.searchParams.set('user', user)
    const authorized = await fetch(authorize, { redirect: 'manual' })
    const callback = new URL(authorized.headers.get('location')!)
    const response = await call(callback.pathname + callback.search, loginCookie, {
      headers: { 'Sec-Fetch-Site': 'cross-site' },
    })
    assert.equal(response.status, 302)
    const sessionCookie = response.headers
      .getSetCookie()
      .find((cookie) => cookie.startsWith(secure ? '__Host-study_session=' : 'study_session='))!
    assert.match(sessionCookie, /HttpOnly/)
    assert.match(sessionCookie, /SameSite=Lax/)
    if (secure) assert.match(sessionCookie, /; Secure/)
    else assert.doesNotMatch(sessionCookie, /; Secure/)
    const cookie = sessionCookie.split(';')[0]!
    const session = await (await call('/api/session', cookie)).json()
    accounts.set(cookie, session.user.id)
    return cookie
  }

  return {
    call,
    login,
    identity,
    app,
    base,
    directory,
    legacyPath,
    advance: (ms: number) => {
      now += ms
    },
    close: async () => {
      await closeServer(server)
      app.close()
      await closeServer(identity.server)
      rmSync(directory, { recursive: true, force: true })
    },
  }
}

test('HTTP login protects the API and gives each account a private library and history', async () => {
  const fixture = await applicationFixture()
  const { call, login } = fixture
  try {
    assert.equal((await call('/api/questions')).status, 401)
    const alice = await login('alice')
    const bob = await login('bob')

    const post = (path: string, data: unknown, cookie: string, method = 'POST') =>
      call(path, cookie, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })

    const input = bank()
    input.questions = Array.from({ length: 20 }, (_, index) => ({
      ...structuredClone(input.questions[0]!),
      source_ref: String(index),
      question: `Synthetic private question ${index}?`,
    }))
    const preview = await (await post('/api/imports/preview', { bank: input }, alice)).json()
    assert.equal(
      (
        await post(
          '/api/imports/confirm',
          { bank: input, token: preview.token, reviewed: false },
          bob,
        )
      ).status,
      409,
    )
    assert.equal(
      (
        await post(
          '/api/imports/confirm',
          { bank: input, token: preview.token, reviewed: false },
          alice,
        )
      ).status,
      201,
    )
    const questions = await (await call('/api/questions', alice)).json()
    assert.equal(questions.total, 20)
    assert.equal((await (await call('/api/questions', bob)).json()).total, 0)
    const id = questions.items[0].id
    assert.equal((await call(`/api/questions/${id}`, bob)).status, 404)
    assert.equal((await call(`/api/questions/${id}`, bob, { method: 'DELETE' })).status, 404)
    const started = await post(
      '/api/quizzes',
      {
        provider: 'Example',
        certification: 'DEMO-1',
        sourceFilter: 'mixed',
        questionType: 'mixed',
      },
      alice,
    )
    assert.equal(started.status, 201)
    const quiz = await started.json()
    assert.equal((await call(`/api/quizzes/${quiz.id}`, bob)).status, 404)
    assert.equal((await post(`/api/quizzes/${quiz.id}/pause`, {}, bob)).status, 404)
    const answers = quiz.questions.map((question: { questionId: number }) => ({
      questionId: question.questionId,
      selected: [],
      confidence: 'Unsure',
      flagged: false,
    }))
    const result = await post(`/api/quizzes/${quiz.id}/submit`, { answers }, alice)
    assert.equal(result.status, 200)
    const historyPath = '/api/quizzes?provider=Example&certification=DEMO-1'
    assert.equal((await (await call(historyPath, alice)).json()).length, 1)
    assert.deepEqual(await (await call(historyPath, bob)).json(), [])
    const aliceAgain = await login('alice')
    assert.equal((await (await call('/api/questions', aliceAgain)).json()).total, 20)
    const user = await (await call('/api/session', alice)).json()
    assert.equal(user.user.name, 'alice')
    assert.deepEqual(Object.keys(user.user).sort(), ['id', 'name'])
    assert.equal(readFileSync(fixture.legacyPath, 'utf8'), 'untouched legacy database sentinel')
    assert.equal(existsSync(join(fixture.directory, 'users', user.user.id + '.sqlite3')), true)
  } finally {
    await fixture.close()
  }
})

test('a stale workspace cannot read or mutate another account even when record IDs collide', async () => {
  const fixture = await applicationFixture()
  try {
    const alice = await fixture.login('alice')
    const bob = await fixture.login('bob')
    const input = bank()
    for (const cookie of [alice, bob]) {
      const post = (path: string, body: unknown) =>
        fixture.call(path, cookie, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })

      const preview = await (await post('/api/imports/preview', { bank: input })).json()
      assert.equal(
        (await post('/api/imports/confirm', { bank: input, token: preview.token, reviewed: false }))
          .status,
        201,
      )
    }
    const aliceSession = await (await fixture.call('/api/session', alice)).json()
    const aliceQuestions = await (await fixture.call('/api/questions', alice)).json()
    const bobQuestions = await (await fixture.call('/api/questions', bob)).json()
    assert.equal(aliceQuestions.items[0].id, bobQuestions.items[0].id)
    const stale = { 'X-Study-Account': aliceSession.user.id }
    assert.equal((await fixture.call('/api/questions', bob, { headers: stale })).status, 409)
    const rejected = await fixture.call(`/api/questions/${aliceQuestions.items[0].id}`, bob, {
      method: 'DELETE',
      headers: stale,
    })
    assert.equal(rejected.status, 409)
    assert.equal((await rejected.json()).code, 'workspace_changed')
    assert.equal((await (await fixture.call('/api/questions', bob)).json()).total, 1)
    assert.equal((await (await fixture.call('/api/questions', alice)).json()).total, 1)
  } finally {
    await fixture.close()
  }
})

test('an HTTPS public origin produces host-only Secure session cookies', async () => {
  const fixture = await applicationFixture(true)
  try {
    const session = await fixture.login('alice')
    assert.match(session, /^__Host-study_session=/)
    assert.equal((await fixture.call('/api/sources', session)).status, 200)
  } finally {
    await fixture.close()
  }
})

test('workspace documents preserve same-origin form origins while authorization responses suppress referrers', async () => {
  const fixture = await applicationFixture()
  try {
    // no-referrer on the document makes browsers send Origin: null for native form POSTs.
    assert.equal((await fixture.call('/')).headers.get('referrer-policy'), 'same-origin')
    assert.equal((await fixture.call('/auth/login')).headers.get('referrer-policy'), 'no-referrer')
  } finally {
    await fixture.close()
  }
})

test('cross-site OIDC return navigation can load the public shell while study APIs remain protected', async () => {
  const fixture = await applicationFixture()
  try {
    const navigation = { headers: { 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'navigate' } }
    assert.equal((await fixture.call('/', '', navigation)).status, 200)
    assert.equal((await fixture.call('/api/sources', '', navigation)).status, 403)
  } finally {
    await fixture.close()
  }
})

test('callbacks are browser-bound, single use, expire, and never expose protocol errors', async () => {
  const fixture = await applicationFixture()
  try {
    for (const scenario of ['missing-cookie', 'wrong-state', 'expired', 'replay'] as const) {
      const start = await fixture.call('/auth/login')
      const loginCookie = start.headers.getSetCookie()[0]!.split(';')[0]!
      const authorized = await fetch(start.headers.get('location')!, { redirect: 'manual' })
      const callback = new URL(authorized.headers.get('location')!)
      if (scenario === 'wrong-state') callback.searchParams.set('state', 'attacker-state')
      if (scenario === 'expired') fixture.advance(600_000)
      const response = await fixture.call(
        callback.pathname + callback.search,
        scenario === 'missing-cookie' ? '' : loginCookie,
      )
      if (scenario === 'replay') {
        assert.equal(response.status, 302)
        assert.equal(
          (await fixture.call(callback.pathname + callback.search, loginCookie)).status,
          400,
        )
      } else {
        assert.equal(response.status, 400)
        assert.equal(
          response.headers.getSetCookie().some((value) => value.startsWith('study_session=')),
          false,
        )
        const text = await response.text()
        assert.doesNotMatch(text, /attacker-state|synthetic-token|code_verifier|id_token/)
      }
    }
  } finally {
    await fixture.close()
  }
})

test('logout and writes require same-origin requests; logout and session expiration revoke access', async () => {
  const fixture = await applicationFixture()
  try {
    const session = await fixture.login('alice')
    assert.equal((await fixture.call('/auth/logout', session)).status, 404)
    assert.equal(
      (
        await fixture.call('/auth/logout', session, {
          method: 'POST',
          headers: { Origin: 'https://untrusted.example' },
        })
      ).status,
      403,
    )
    assert.equal(
      (await fixture.call('/api/sources', session, { headers: { 'Sec-Fetch-Site': 'cross-site' } }))
        .status,
      403,
    )
    const missingOrigin = await fetch(fixture.base + '/auth/logout', {
      method: 'POST',
      redirect: 'manual',
      headers: { Cookie: session },
    })
    assert.equal(missingOrigin.status, 403)
    assert.equal((await fixture.call('/api/sources', session)).status, 200)
    const logout = await fixture.call('/auth/logout', session, { method: 'POST' })
    assert.equal(logout.status, 303)
    assert.match(logout.headers.getSetCookie()[0]!, /Max-Age=0/)
    assert.equal((await fixture.call('/api/sources', session)).status, 401)
    const next = await fixture.login('alice')
    fixture.advance(8 * 60 * 60_000)
    assert.equal((await fixture.call('/api/sources', next)).status, 401)
    assert.deepEqual(await (await fixture.call('/api/session', next)).json(), { user: null })
  } finally {
    await fixture.close()
  }
})
