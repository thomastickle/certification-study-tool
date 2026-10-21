import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { test } from 'node:test'
import { apiController } from '../src/server/http-controller.ts'
import { LibraryRepository } from '../src/server/questions/library-repository.ts'
import { QuizService } from '../src/server/quizzes/quiz-service.ts'
import { populate } from './quiz-fixtures.ts'

test('HTTP deletes, lists, restores and permanently deletes results without allowing cross-site changes', async () => {
  const repository = new LibraryRepository(':memory:')
  populate(repository)
  const service = new QuizService(repository)
  const quiz = service.start({ sourceFilter: 'mixed', questionType: 'mixed' })
  service.submit(quiz.id, {
    answers: quiz.questions.map((q) => ({
      questionId: q.questionId,
      selected: [],
      confidence: null,
      flagged: false,
    })),
  })
  const server = createServer(apiController(repository))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const base = `http://127.0.0.1:${address.port}/api/quizzes`
  try {
    const denied = { Origin: 'https://untrusted.example' }
    assert.equal(
      (await fetch(`${base}/${quiz.id}`, { method: 'DELETE', headers: denied })).status,
      403,
    )
    const response = await fetch(`${base}/${quiz.id}`, { method: 'DELETE' })
    assert.equal(response.status, 200)
    const deleted = await response.json()
    assert.equal(deleted.id, quiz.id)
    assert.equal(deleted.purgeAt - deleted.deletedAt, 48 * 60 * 60 * 1000)
    assert.equal('questions' in deleted, false)
    assert.deepEqual(await (await fetch(base)).json(), [])
    assert.equal((await fetch(`${base}/${quiz.id}`)).status, 404)
    assert.equal((await (await fetch(`${base}/deleted`)).json()).length, 1)
    assert.deepEqual(
      await (await fetch(`${base}/deleted?provider=Other&certification=X`)).json(),
      [],
    )
    assert.equal(
      (await fetch(`${base}/${quiz.id}/restore`, { method: 'POST', headers: denied })).status,
      403,
    )
    assert.equal((await fetch(`${base}/${quiz.id}/restore`, { method: 'POST' })).status, 200)
    assert.equal((await (await fetch(base)).json()).length, 1)
    assert.equal(
      (await fetch(`${base}/${quiz.id}?permanent=oops`, { method: 'DELETE' })).status,
      400,
    )
    await fetch(`${base}/${quiz.id}`, { method: 'DELETE' })
    assert.equal(
      (await fetch(`${base}/${quiz.id}?permanent=true`, { method: 'DELETE', headers: denied }))
        .status,
      403,
    )
    assert.equal(
      (await fetch(`${base}/${quiz.id}?permanent=true`, { method: 'DELETE' })).status,
      200,
    )
    assert.deepEqual(await (await fetch(`${base}/deleted`)).json(), [])
    assert.equal((await fetch(`${base}/${quiz.id}/restore`, { method: 'POST' })).status, 404)
    assert.equal(
      (await (await fetch('http://127.0.0.1:' + address.port + '/api/reports')).json()).counts
        .total,
      0,
    )
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    repository.close()
  }
})
