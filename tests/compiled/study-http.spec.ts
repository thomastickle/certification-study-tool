import { ApplicationRuntime } from '../../src/server/runtime/application-runtime.ts'
import { QuizService } from '../../src/server/quizzes/quiz-service.ts'
import { populate } from '../quiz-fixtures.ts'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { StudyHttpModule } from '../../src/server/study-http/study.module.ts'
import { fixture } from './study-http-fixture.ts'

test('study home is actor authenticated and available on the compiled Nest surface', async () => {
  const f = await fixture(undefined, [StudyHttpModule])
  try {
    assert.equal((await f.call('/api/home')).status, 401)
    const actor = await f.login('alice')
    assert.equal((await f.authorized('/api/home', actor)).status, 200)
  } finally {
    await f.close()
  }
})

test('study quiz and report routes authenticate, reject malformed raw IDs before bodies', async () => {
  const f = await fixture(undefined, [StudyHttpModule])
  try {
    const actor = await f.login('bob')
    for (const path of [
      '/api/quizzes',
      '/api/quizzes/due',
      '/api/quizzes/current',
      '/api/quizzes/deleted',
      '/api/reports',
    ]) {
      assert.equal((await f.authorized(path, actor)).status, 200, path)
    }
    for (const id of ['invalid', 'A'.repeat(36), '%61'.repeat(36), 'a'.repeat(35)]) {
      assert.equal(
        (await f.authorized('/api/quizzes/' + id + '/answers', actor, 'PUT', {}, 'bad')).status,
        404,
        id,
      )
    }
  } finally {
    await f.close()
  }
})

test('two OIDC actors keep colliding private content, attempts, history and earned settings isolated', async () => {
  const f = await fixture(undefined, [StudyHttpModule])
  try {
    const alice = await f.login('alice')
    const bob = await f.login('bob')
    const runtime = f.app.get(ApplicationRuntime)
    populate(runtime.sharedLibrary, 12)
    const personal = runtime.privateLibraries.open(f.sessions.get(alice)!)
    try {
      populate(personal, 12, 'private-collision')
    } finally {
      personal.close()
    }

    const call = async (path: string, method = 'GET', input?: unknown, actor = alice) => {
      const response = await f.authorized(
        path,
        actor,
        method,
        input === undefined ? {} : { 'Content-Type': 'application/json' },
        input === undefined ? undefined : JSON.stringify(input),
      )
      return { ...response, value: response.body ? JSON.parse(response.body) : undefined }
    }

    const created = await call('/api/quizzes', 'POST', {
      sourceFilter: 'mixed',
      questionType: 'mixed',
    })
    assert.equal(created.status, 201)
    const quiz = created.value
    const path = '/api/quizzes/' + quiz.id
    assert.ok(quiz.questions.length > 0)
    assert.equal('keys' in quiz, false)
    for (const question of quiz.questions) {
      assert.equal('correct' in question, false)
      assert.equal('explanation' in question, false)
    }
    assert.equal((await call(path, 'GET', undefined, bob)).status, 404)
    assert.equal((await call('/api/quizzes/current', 'GET', undefined, bob)).value, null)
    assert.equal((await call(path + '/answers', 'PUT', { answers: [] }, bob)).status, 404)
    const answers = quiz.questions.map((q: { questionId: number }) => ({
      questionId: q.questionId,
      selected: [],
      confidence: null,
      flagged: true,
    }))
    assert.equal((await call(path + '/answers', 'PUT', { answers })).status, 200)
    assert.equal((await call(path + '/pause', 'POST')).value.status, 'paused')
    assert.equal((await call('/api/reports')).value.counts.total, 0)
    assert.equal((await call(path + '/pause', 'POST', { cause: 'invented' })).status, 400)
    assert.equal((await call(path + '/resume', 'POST')).value.status, 'active')
    assert.equal((await call(path + '/submit', 'POST', { answers }, bob)).status, 404)
    const submitted = await call(path + '/submit', 'POST', { answers })
    assert.equal(submitted.status, 200)
    assert.equal((await call('/api/reports')).value.counts.total, quiz.questions.length)
    assert.equal((await call('/api/reports', 'GET', undefined, bob)).value.counts.total, 0)
    assert.equal((await call(path + '?permanent=oops', 'DELETE')).status, 400)
    const deleted = await call(path + '?permanent=false&permanent=oops', 'DELETE')
    assert.equal(deleted.status, 200)
    assert.equal(deleted.value.purgeAt - deleted.value.deletedAt, 48 * 60 * 60 * 1000)
    assert.equal('questions' in deleted.value, false)
    assert.equal((await call(path)).status, 404)
    assert.equal((await call('/api/quizzes/deleted')).value.length, 1)
    assert.equal((await call('/api/quizzes/deleted', 'GET', undefined, bob)).value.length, 0)
    assert.equal((await call(path + '/restore', 'POST', undefined, bob)).status, 404)
    assert.equal((await call(path + '/restore', 'POST')).status, 200)
    assert.equal((await call('/api/quizzes?provider=Other&provider=AWS')).value.length, 0)
    assert.equal((await call('/api/quizzes/current?mode=invalid&mode=quiz')).status, 400)
    assert.equal((await call('/api/quizzes/due?sourceIds=invalid')).status, 400)
    assert.equal((await call('/api/quizzes/due')).status, 200)
    const earned = { provider: 'AWS', code: 'CLF-C02', earned: true }
    const initial = (await call('/api/home')).value
    const marked = await call('/api/certifications/earned', 'PUT', earned)
    assert.equal(marked.status, 200)
    assert.equal(marked.value.providers[0].certifications[0].earned, true)
    assert.deepEqual(
      marked.value.providers[0].certifications[0].readiness,
      initial.providers[0].certifications[0].readiness,
    )
    assert.equal(
      (await call('/api/home', 'GET', undefined, bob)).value.providers[0].certifications[0].earned,
      false,
    )
    assert.equal(
      (await call('/api/certifications/earned', 'PUT', { ...earned, earned: 'true' })).status,
      400,
    )
    assert.equal(
      (await call('/api/certifications/earned', 'PUT', { ...earned, code: 'missing' })).status,
      404,
    )
    await f.restart()
    assert.equal((await call('/api/home')).value.providers[0].certifications[0].earned, true)
    assert.equal((await call(path)).status, 200)
    await call(path, 'DELETE')
    assert.equal((await call(path + '?permanent=true', 'DELETE')).status, 200)
    assert.equal((await call(path + '/restore', 'POST')).status, 404)
    const next = await call('/api/quizzes', 'POST', {
      sourceFilter: 'mixed',
      questionType: 'mixed',
    })
    assert.equal((await call('/api/quizzes/' + next.value.id + '/abandon', 'POST')).status, 200)
  } finally {
    await f.close()
  }
})

test('unsupported routes, methods and bodies preserve HTTP ordering and first query values', async () => {
  const f = await fixture(undefined, [StudyHttpModule])
  try {
    const actor = await f.login('bob')
    for (const path of [
      '/api/home/',
      '/api/Home',
      '/api/shared/home',
      '/api/private/quizzes',
      '/api/quizzes/unknown',
    ]) {
      assert.equal((await f.authorized(path, actor)).status, 404, path)
    }
    for (const method of ['HEAD', 'OPTIONS', 'PATCH']) {
      assert.equal((await f.authorized('/api/quizzes', actor, method)).status, 404, method)
    }
    const id = '-'.repeat(36)
    assert.equal((await f.authorized('/api/quizzes/' + id, actor)).status, 404)
    assert.equal(
      (await f.authorized('/api/quizzes/' + id + '/answers', actor, 'PUT', {}, 'bad')).status,
      415,
    )
    assert.equal((await f.call('/api/quizzes/invalid/answers', 'PUT', {}, 'bad')).status, 401)
    assert.equal(
      (
        await f.authorized(
          '/api/quizzes',
          actor,
          'POST',
          { 'Content-Type': 'application/json' },
          '[]',
        )
      ).status,
      400,
    )
    assert.equal(
      (
        await f.authorized(
          '/api/quizzes',
          actor,
          'POST',
          { 'Content-Type': 'Application/json' },
          '{}',
        )
      ).status,
      415,
    )
    assert.equal(
      (await f.authorized('/api/home', actor, 'GET', { Origin: 'https://foreign.example' })).status,
      403,
    )
    assert.equal(
      (await f.authorized('/api/home', actor, 'GET', { 'X-Study-Account': 'foreign' })).status,
      409,
    )
    for (const action of ['resume', 'abandon', 'restore']) {
      assert.equal(
        (await f.authorized('/api/quizzes/' + id + '/' + action, actor, 'POST', {}, 'bad')).status,
        action === 'abandon' ? 200 : 404,
      )
    }
  } finally {
    await f.close()
  }
})

test('overdue paused snapshots retain answers and history without grading until resumed', async () => {
  const f = await fixture(undefined, [StudyHttpModule])
  try {
    const actor = await f.login('alice')
    const runtime = f.app.get(ApplicationRuntime)
    populate(runtime.sharedLibrary, 24)
    for (const mode of ['quiz', 'exam'] as const) {
      const personal = runtime.privateLibraries.open(f.sessions.get(actor)!)
      let id: string
      let deadline: number
      try {
        let now = Date.now() - 86400000
        const service = new QuizService(
          runtime.sharedLibrary.forAccount(f.sessions.get(actor)!, personal),
          () => now,
        )
        const quiz = service.start({ mode, sourceFilter: 'mixed', questionType: 'mixed' })
        id = quiz.id
        deadline = quiz.deadline
        service.save(id, {
          answers: quiz.questions.map((q) => ({
            questionId: q.questionId,
            selected: [],
            confidence: null,
            flagged: true,
          })),
        })
        now += 1234
        service.pause(id, { cause: 'navigation' })
      } finally {
        personal.close()
      }
      const base = '/api/quizzes/' + id!
      const paused = JSON.parse((await f.authorized(base, actor)).body)
      assert.equal(paused.status, 'paused')
      assert.ok(paused.serverNow > deadline!)
      assert.ok(paused.questions.every((q: { flagged: boolean }) => q.flagged))
      assert.equal(
        JSON.parse((await f.authorized('/api/reports?mode=' + mode, actor)).body).counts.total,
        0,
      )
      const retry = JSON.parse((await f.authorized(base + '/pause', actor, 'POST')).body)
      assert.deepEqual(retry.pauseHistory, paused.pauseHistory)
      const resumed = JSON.parse((await f.authorized(base + '/resume', actor, 'POST')).body)
      assert.equal(resumed.status, 'active')
      assert.ok(resumed.deadline > resumed.serverNow)
      assert.equal(
        JSON.parse((await f.authorized(base + '/resume', actor, 'POST')).body).deadline,
        resumed.deadline,
      )
      assert.equal((await f.authorized(base + '/abandon', actor, 'POST')).status, 200)
    }
  } finally {
    await f.close()
  }
})

for (const kind of ['missing', 'foreign', 'permanent'] as const) {
  test(`quiz DELETE returns JSON null for ${kind} results without reading a body`, async () => {
    const f = await fixture(undefined, [StudyHttpModule])
    try {
      const alice = await f.login('alice')
      let actor = alice
      let path = '/api/quizzes/' + '-'.repeat(36)
      if (kind !== 'missing') {
        populate(f.app.get(ApplicationRuntime).sharedLibrary, 12)
        const created = await f.authorized(
          '/api/quizzes',
          alice,
          'POST',
          {
            'Content-Type': 'application/json',
          },
          JSON.stringify({ sourceFilter: 'mixed', questionType: 'mixed' }),
        )
        assert.equal(created.status, 201)
        const quiz = JSON.parse(created.body)
        path = '/api/quizzes/' + quiz.id
        const answers = quiz.questions.map((question: { questionId: number }) => ({
          questionId: question.questionId,
          selected: [],
          confidence: null,
          flagged: false,
        }))
        const submitted = await f.authorized(
          path + '/submit',
          alice,
          'POST',
          {
            'Content-Type': 'application/json',
          },
          JSON.stringify({ answers }),
        )
        assert.equal(submitted.status, 200)
        if (kind === 'foreign') {
          actor = await f.login('bob')
        } else {
          const soft = await f.authorized(path, alice, 'DELETE')
          assert.equal(soft.status, 200)
          assert.equal(JSON.parse(soft.body).status, 'deleted')
          assert.match(soft.headers['content-type']!, /^application\/json(?:;|$)/)
        }
      }
      for (const permanent of kind === 'permanent' ? [true] : [false, true]) {
        const response = await f.authorized(
          path + '?permanent=' + permanent,
          actor,
          'DELETE',
          {
            'Content-Type': 'text/plain',
            'Content-Length': '4',
          },
          'oops',
        )
        assert.equal(response.status, 200)
        assert.equal(response.body, 'null', 'successful deletion responses remain consumable JSON')
        assert.equal(JSON.parse(response.body), null)
        assert.match(response.headers['content-type']!, /^application\/json(?:;|$)/)
        assert.equal(response.headers['cache-control'], 'no-store')
        assert.equal(response.headers['x-content-type-options'], 'nosniff')
      }
      if (kind === 'foreign') {
        const unchanged = await f.authorized(path, alice)
        assert.equal(unchanged.status, 200)
        assert.equal(JSON.parse(unchanged.body).status, 'completed')
      } else if (kind === 'permanent') {
        assert.equal((await f.authorized(path, alice)).status, 404)
        assert.deepEqual(JSON.parse((await f.authorized('/api/quizzes/deleted', alice)).body), [])
      }
    } finally {
      await f.close()
    }
  })
}
