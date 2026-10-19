import assert from 'node:assert/strict'
import { test } from 'node:test'
import { LibraryRepository } from '../src/server/questions/library-repository.ts'
import { QuizService } from '../src/server/quizzes/quiz-service.ts'
import { populate } from './quiz-fixtures.ts'

for (const mode of ['quiz', 'exam'] as const) {
  test(`${mode} pause freezes time and mastery, survives service restart, and resumes idempotently`, () => {
    const repository = new LibraryRepository(':memory:')
    try {
      populate(repository, 24)
      let now = 1000
      const service = new QuizService(repository, () => now)
      const attempt = service.start({ mode, sourceFilter: 'mixed', questionType: 'mixed' })
      now += 60_000
      assert.equal(typeof service.pause, 'function', 'Practice sessions need a pause operation')
      const paused = service.pause(attempt.id)
      assert.equal(paused.status, 'paused')
      assert.equal(paused.pausedAt, now)
      now += 24 * 60 * 60_000
      const restarted = new QuizService(repository, () => now)
      restarted.expireDue()
      assert.equal(restarted.get(attempt.id).status, 'paused')
      assert.equal(restarted.recent().length, 0)
      assert.equal(repository.quizStore().boosts().size, 0)
      assert.equal(restarted.current(mode)?.id, attempt.id)
      assert.equal(restarted.pause(attempt.id).pausedAt, paused.pausedAt)
      assert.equal(restarted.submit(attempt.id, { answers: [] }).status, 'paused')
      const resumed = restarted.resume(attempt.id)
      assert.equal(resumed.status, 'active')
      assert.equal(resumed.pausedAt, null)
      assert.equal(resumed.deadline - now, attempt.deadline - paused.pausedAt!)
      assert.equal(restarted.resume(attempt.id).deadline, resumed.deadline)
      now = resumed.deadline
      restarted.expireDue()
      assert.equal(restarted.get(attempt.id).status, 'completed')
      assert.equal(repository.quizStore().boosts().size, attempt.total)
    } finally {
      repository.close()
    }
  })
}

test('paused answers stay frozen, another mode does not erase them, and abandon never grades', () => {
  const repository = new LibraryRepository(':memory:')
  try {
    populate(repository, 24)
    let now = 1000
    const service = new QuizService(repository, () => now)
    const exam = service.start({ mode: 'exam', sourceFilter: 'mixed', questionType: 'mixed' })
    const answers = exam.questions.map((q, i) => ({
      questionId: q.questionId,
      selected: i === 0 ? [q.answers[0]!.id] : [],
      confidence: 'Unsure',
      flagged: i === 0,
    }))
    service.save(exam.id, { answers })
    service.pause(exam.id)
    now += 10_000_000
    assert.throws(
      () => service.start({ mode: 'exam', sourceFilter: 'mixed', questionType: 'mixed' }),
      /Resume or abandon/,
    )
    service.start({ mode: 'quiz', sourceFilter: 'mixed', questionType: 'mixed' })
    const paused = service.save(exam.id, { answers: [] })
    assert.equal(paused.status, 'paused')
    assert.deepEqual(paused.questions[0]!.selected, answers[0]!.selected)
    assert.equal(paused.questions[0]!.flagged, true)
    assert.equal(service.current('exam')?.id, exam.id)
    assert.equal(service.abandon(exam.id)?.status, 'abandoned')
    assert.equal(service.current('exam'), null)
    assert.equal(repository.quizStore().boosts().size, 0)
  } finally {
    repository.close()
  }
})

test('pausing at the deadline cannot prevent normal expiry or expose an editable result', () => {
  const repository = new LibraryRepository(':memory:')
  try {
    populate(repository)
    let now = 1000
    const service = new QuizService(repository, () => now)
    const quiz = service.start({ sourceFilter: 'mixed', questionType: 'mixed' })
    now = quiz.deadline
    assert.equal(service.pause(quiz.id).status, 'completed')
    assert.equal(service.resume(quiz.id).status, 'completed')
    assert.equal(service.current('quiz'), null)
    assert.equal(repository.quizStore().boosts().size, 20)
  } finally {
    repository.close()
  }
})
