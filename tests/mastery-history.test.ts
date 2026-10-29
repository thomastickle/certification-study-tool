import { prepareManagedDatabase } from './managed-database-fixture.ts'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { LibraryRepository } from '../src/server/questions/library-repository.ts'
import { QuizService } from '../src/server/quizzes/quiz-service.ts'
import { masteryHistory } from '../src/server/quizzes/mastery-history.ts'
import { populate } from './quiz-fixtures.ts'

const options = { sourceFilter: 'mixed', questionType: 'mixed' }

test('only submitted completed snapshots supply mastery, replay survives restart and ignores legacy streaks', () => {
  const repository = new LibraryRepository(prepareManagedDatabase())
  try {
    populate(repository)
    const service = new QuizService(
      repository,
      () => 1000,
      () => 0.2,
    )
    const quiz = service.start(options)
    const saved = repository.quizStore().find(quiz.id)!
    const answers = quiz.questions.map((q, i) => ({
      ...q,
      selected: saved.keys[i]!.correct,
      confidence: 'Confident' as const,
    }))
    service.save(quiz.id, { answers })
    assert.equal(masteryHistory(repository.quizStore().completed()).states.size, 0)
    service.pause(quiz.id)
    assert.equal(masteryHistory(repository.quizStore().completed()).states.size, 0)
    service.resume(quiz.id)
    service.submit(quiz.id, { answers })
    const history = masteryHistory(repository.quizStore().completed())
    assert.equal(history.states.size, 20)
    assert.ok([...history.states.values()].every((s) => s.mastered && s.masteryOrigin === 'first'))
    assert.deepEqual(masteryHistory(repository.quizStore().completed()), history)
    service.submit(quiz.id, { answers: [] })
    assert.deepEqual(masteryHistory(repository.quizStore().completed()), history)
    const legacy = repository.quizStore().find(quiz.id)!
    delete (legacy.questions[0] as { confidence?: unknown }).confidence
    legacy.questions[1]!.correctAnswerIds = [999]
    legacy.finishedAt = NaN
    assert.equal([...masteryHistory([legacy]).states.values()].filter((s) => s.mastered).length, 0)
    legacy.finishedAt = 1000
    assert.equal([...masteryHistory([legacy]).states.values()].filter((s) => s.mastered).length, 18)
  } finally {
    repository.close()
  }
})

test('same-day confident practice scores normally without earning miss-recovery days', () => {
  const repository = new LibraryRepository(prepareManagedDatabase())
  try {
    populate(repository)
    let now = Date.parse('2026-03-07T17:00:00Z')
    const service = new QuizService(
      repository,
      () => now,
      () => 0,
    )
    const first = service.start(options)
    const target = first.questions.find((q) => q.type === 'single_select')!
    const answers = first.questions.map((q) => ({
      ...q,
      selected: q.question === target.question ? [0] : [],
      confidence: 'Confident' as const,
    }))
    const firstStored = repository.quizStore().find(first.id)!
    const key = firstStored.keys[target.questionId]!.correct
    answers[target.questionId]!.selected = [key.includes(0) ? 1 : 0]
    service.submit(first.id, { answers })
    let state = [...masteryHistory(repository.quizStore().completed()).states.values()].find(
      (s) => s.recovery === 'miss',
    )!
    assert.equal(state.required, 3)
    for (let index = 0; index < 2; index++) {
      now++
      const next = service.start(options)
      const stored = repository.quizStore().find(next.id)!
      const chosen = next.questions.find((q) => q.question === target.question)!
      assert.ok(chosen, 'Recovery does not exclude same-day regular practice')
      const result = service.submit(next.id, {
        answers: next.questions.map((q, i) => ({
          ...q,
          selected: q.question === target.question ? stored.keys[i]!.correct : [],
          confidence: 'Confident',
        })),
      })
      assert.equal(result.correctCount, 1)
      assert.equal(result.total, 20)
      state = [...masteryHistory(repository.quizStore().completed()).states.values()].find(
        (s) => s.recovery === 'miss',
      )!
      assert.equal(state.progress, 0)
      assert.equal(state.mastered, false)
    }
  } finally {
    repository.close()
  }
})
