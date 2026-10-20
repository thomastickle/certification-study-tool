import assert from 'node:assert/strict'
import { test } from 'node:test'
import { LibraryRepository } from '../src/server/questions/library-repository.ts'
import { QuizService } from '../src/server/quizzes/quiz-service.ts'
import { quizReport } from '../src/shared/quiz-report.ts'
import { populate } from './quiz-fixtures.ts'

const options = { sourceFilter: 'mixed', questionType: 'mixed', mode: 'exam' }

test('exam selects 65 unique questions in representative domains with a 90-minute deadline', () => {
  const repository = new LibraryRepository(':memory:')
  try {
    populate(repository, 24)
    const before = repository.allQuestions()
    const service = new QuizService(
      repository,
      () => 1000,
      () => 0.4,
    )
    const exam = service.start(options)
    assert.equal(exam.total, 65)
    assert.equal(exam.questions.length, 65)
    assert.equal(exam.deadline, 1000 + 90 * 60_000)
    assert.equal(exam.options.mode, 'exam')
    assert.deepEqual(
      [1, 2, 3, 4].map((d) => exam.questions.filter((q) => q.domain === d).length),
      [16, 19, 22, 8],
    )
    assert.equal(new Set(exam.questions.map((q) => q.question)).size, 65)
    assert.ok(
      exam.questions.every(
        (q) =>
          q.correctAnswerIds === undefined &&
          q.correct === undefined &&
          q.answers.every((a) => !('correct' in a)),
      ),
    )
    assert.deepEqual(repository.allQuestions(), before)
  } finally {
    repository.close()
  }
})

test('exam saves, expires from saved choices, and identifies its history and report', () => {
  const repository = new LibraryRepository(':memory:')
  try {
    populate(repository, 24)
    let now = 1000
    const service = new QuizService(
      repository,
      () => now,
      () => 0.4,
    )
    const exam = service.start(options)
    const stored = repository.quizStore().find(exam.id)!
    const answers = exam.questions.map((q, i) => ({
      questionId: q.questionId,
      selected: i < 52 ? stored.keys[i]!.correct : [],
      confidence: 'Unsure',
      flagged: true,
    }))
    service.save(exam.id, { answers })
    now = exam.deadline - 1
    assert.equal(service.get(exam.id).status, 'active')
    now++
    service.expireDue()
    const result = service.submit(exam.id, { answers: [] })
    assert.equal(result.status, 'completed')
    assert.equal(result.finishedAt, exam.deadline)
    assert.equal(result.correctCount, 52)
    assert.equal(result.questions[0]!.confidence, 'Unsure')
    assert.equal(result.questions[0]!.flagged, true)
    assert.equal(repository.quizStore().boosts().size, 13)
    assert.equal(service.recent()[0]!.mode, 'exam')
    assert.match(quizReport(result), /# CLF-C02 practice exam report/)
    assert.match(quizReport(result), /Pass — 52\/65 \(80%\)/)
    assert.deepEqual(service.submit(exam.id, { answers: [] }), result)
    const quiz = service.start({ sourceFilter: 'mixed', questionType: 'mixed' })
    service.submit(quiz.id, {
      answers: quiz.questions.map((q) => ({
        questionId: q.questionId,
        selected: [],
        confidence: null,
        flagged: false,
      })),
    })
    assert.deepEqual(new Set(service.recent().map((q) => q.mode)), new Set(['quiz', 'exam']))
  } finally {
    repository.close()
  }
})

test('exam honors bank filters and rejects shortages or invalid modes without abandoning an active attempt', () => {
  const repository = new LibraryRepository(':memory:')
  try {
    populate(repository)
    const service = new QuizService(repository)
    const quiz = service.start({ sourceFilter: 'mixed', questionType: 'mixed' })
    assert.throws(
      () => service.start(options),
      /Domain 1 needs 16 unique mapped questions; only 12/,
    )
    assert.equal(service.get(quiz.id).status, 'active')
    assert.throws(() => service.start({ ...options, sourceIds: [] }), /source/i)
    assert.throws(() => service.start({ ...options, mode: 'invalid' }), /practice mode/)
    assert.throws(() => service.start({ ...options, sourceFilter: 'official' }), /only 0/)
  } finally {
    repository.close()
  }
})
