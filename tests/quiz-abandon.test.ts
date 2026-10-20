import assert from 'node:assert/strict'
import { test } from 'node:test'
import { LibraryRepository } from '../src/server/questions/library-repository.ts'
import { QuizService } from '../src/server/quizzes/quiz-service.ts'
import { populate } from './quiz-fixtures.ts'

for (const mode of ['quiz', 'exam'] as const) {
  for (const paused of [false, true]) {
    test(`${mode} abandonment discards the ${paused ? 'paused' : 'active'} snapshot without any result or mastery changes`, () => {
      const repository = new LibraryRepository(':memory:')
      try {
        populate(repository, 24)
        let now = 1000
        const service = new QuizService(repository, () => now)
        const attempt = service.start({ mode, sourceFilter: 'mixed', questionType: 'mixed' })
        service.save(attempt.id, {
          answers: attempt.questions.map((question) => ({
            questionId: question.questionId,
            selected: [question.answers[0]!.id],
            confidence: 'Confident',
            flagged: true,
          })),
        })
        if (paused) service.pause(attempt.id)
        const result = service.abandon(attempt.id)
        assert.equal(result?.status, 'abandoned')
        assert.equal(result?.correctCount, null)
        assert.equal(repository.quizStore().find(attempt.id), undefined)
        assert.equal(service.current(mode), null)
        assert.equal(service.abandon(attempt.id), null)
        now = attempt.deadline + 1
        service.expireDue()
        assert.deepEqual(service.recent(), [])
        assert.equal(repository.quizStore().boosts().size, 0)
        assert.throws(() => service.submit(attempt.id, { answers: [] }), /not found/)
      } finally {
        repository.close()
      }
    })
  }
}

test('replacing an unfinished active attempt also discards it without grading', () => {
  const repository = new LibraryRepository(':memory:')
  try {
    populate(repository)
    const service = new QuizService(repository, () => 1000)
    const options = { sourceFilter: 'mixed', questionType: 'mixed' }
    const previous = service.start(options)
    service.start(options)
    assert.equal(repository.quizStore().find(previous.id), undefined)
    assert.deepEqual(service.recent(), [])
    assert.equal(repository.quizStore().boosts().size, 0)
  } finally {
    repository.close()
  }
})

test('explicit abandonment cannot trigger expiry scoring; completed results stay intact', () => {
  const repository = new LibraryRepository(':memory:')
  try {
    populate(repository)
    let now = 1000
    const service = new QuizService(repository, () => now)
    const options = { sourceFilter: 'mixed', questionType: 'mixed' }
    const unfinished = service.start(options)
    now = unfinished.deadline + 1
    assert.equal(service.abandon(unfinished.id)?.status, 'abandoned')
    assert.equal(repository.quizStore().find(unfinished.id), undefined)
    assert.equal(service.recent().length, 0)
    assert.equal(repository.quizStore().boosts().size, 0)
    const completed = service.start(options)
    const result = service.submit(completed.id, {
      answers: completed.questions.map((question) => ({
        questionId: question.questionId,
        selected: [],
        confidence: null,
        flagged: false,
      })),
    })
    assert.deepEqual(service.abandon(completed.id), result)
    assert.equal(service.recent().length, 1)
    assert.equal(repository.quizStore().boosts().size, 0)
  } finally {
    repository.close()
  }
})
