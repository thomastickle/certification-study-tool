import assert from 'node:assert/strict'
import { test } from 'node:test'
import { LibraryRepository } from '../src/server/questions/library-repository.ts'
import { QuizService } from '../src/server/quizzes/quiz-service.ts'
import { populate } from './quiz-fixtures.ts'

const options = { sourceFilter: 'mixed', questionType: 'mixed' }

test('Due Review preserves quotas, does not advance early, honors filters and keeps deleted items overdue', () => {
  const repository = new LibraryRepository(':memory:')
  try {
    populate(repository)
    let now = Date.parse('2026-10-20T16:00:00Z')
    const service = new QuizService(
      repository,
      () => now,
      () => 0.3,
    )
    const quiz = service.start(options)
    const keys = repository.quizStore().find(quiz.id)!.keys
    service.submit(quiz.id, {
      answers: quiz.questions.map((q, i) => ({
        ...q,
        selected: keys[i]!.correct,
        confidence: 'Confident',
      })),
    })
    assert.equal(service.due(options).total, 0)
    assert.throws(() => service.start({ ...options, mode: 'review' }), /No eligible due/)
    now = Date.parse('2026-10-27T04:00:00Z')
    assert.deepEqual(service.due(options), {
      total: 20,
      eligible: 20,
      excluded: 0,
      unavailable: 0,
      oldestDay: '2026-10-27',
    })
    const filtered = service.due({ ...options, questionType: 'single_select' })
    assert.ok(filtered.excluded > 0)
    assert.equal(filtered.eligible + filtered.excluded, 20)
    assert.throws(
      () => service.start({ ...options, mode: 'review', sourceFilter: 'official' }),
      /No eligible due/,
    )
    const review = service.start({ ...options, mode: 'review' })
    assert.equal(review.mode, 'review')
    assert.equal(review.total, 20)
    service.pause(review.id)
    now += 86400000
    assert.equal(service.current('review')?.status, 'paused')
    assert.equal(service.due(options).total, 20)
    service.resume(review.id)
    service.submit(review.id, {
      answers: review.questions.map((q) => ({ ...q, selected: [], confidence: null })),
    })
    assert.equal(service.due(options).total, 20)
    const next = service.start({ ...options, mode: 'review' })
    const nextKeys = repository.quizStore().find(next.id)!.keys
    service.submit(next.id, {
      answers: next.questions.map((q, i) => ({
        ...q,
        selected: nextKeys[i]!.correct,
        confidence: 'Confident',
      })),
    })
    assert.equal(service.due(options).total, 0)
    now = Date.parse('2026-11-11T17:00:00Z')
    assert.equal(service.due(options).total, 20)
    const active = service.start({ ...options, mode: 'review' })
    service.abandon(active.id)
    assert.equal(service.due(options).total, 20)
    for (const source of repository.sources()) {
      repository.deleteSource(source.id)
    }
    assert.deepEqual(service.due(options), {
      total: 20,
      eligible: 0,
      excluded: 0,
      unavailable: 20,
      oldestDay: '2026-11-11',
    })
    assert.throws(() => service.start({ ...options, mode: 'review' }), /unavailable/)
    assert.equal(service.get(next.id).questions.length, 20)
  } finally {
    repository.close()
  }
})

test('review expiry scores saved evidence, repeated submission is idempotent and review is excluded from pass targets', async () => {
  const { ReportService } = await import('../src/server/reports/report-service.ts')
  const { quizReport } = await import('../src/shared/quiz-report.ts')
  const repository = new LibraryRepository(':memory:')
  try {
    populate(repository)
    let now = Date.parse('2026-10-20T16:00:00Z')
    const service = new QuizService(
      repository,
      () => now,
      () => 0,
    )
    const first = service.start(options)
    const firstKeys = repository.quizStore().find(first.id)!.keys
    service.submit(first.id, {
      answers: first.questions.map((q, i) => ({
        ...q,
        selected: firstKeys[i]!.correct,
        confidence: 'Confident',
      })),
    })
    now += 7 * 86400000
    const review = service.start({ ...options, mode: 'review' })
    const keys = repository.quizStore().find(review.id)!.keys
    service.save(review.id, {
      answers: review.questions.map((q, i) => ({
        ...q,
        selected: keys[i]!.correct,
        confidence: i === 0 ? null : 'Confident',
      })),
    })
    now = review.deadline
    const restarted = new QuizService(repository, () => now)
    restarted.expireDue()
    assert.equal(restarted.get(review.id).correctCount, 20)
    restarted.submit(review.id, { answers: [] })
    assert.equal(restarted.due(options).total, 1)
    const report = new ReportService(repository, () => now).get({ mode: 'review' })
    assert.equal(report.targetAttempts, 0)
    assert.equal(report.passingAttempts, 0)
    assert.equal(report.attempts[0]!.passed, null)
    assert.equal(report.counts.score, 100)
    assert.doesNotMatch(quizReport(restarted.get(review.id)), /Result: Pass|Practice target: 80%/)
    assert.equal(new ReportService(repository, () => now).get({ mode: 'quiz' }).counts.total, 20)
  } finally {
    repository.close()
  }
})

test('edited keys cannot inherit old due identities and historical results remain unchanged', async () => {
  const { ImportService } = await import('../src/server/importer/import-service.ts')
  const repository = new LibraryRepository(':memory:')
  try {
    const input = populate(repository)
    let now = Date.parse('2026-10-20T16:00:00Z')
    const service = new QuizService(
      repository,
      () => now,
      () => 0,
    )
    const first = service.start(options)
    const keys = repository.quizStore().find(first.id)!.keys
    const result = service.submit(first.id, {
      answers: first.questions.map((q, i) => ({
        ...q,
        selected: keys[i]!.correct,
        confidence: 'Confident',
      })),
    })
    const single = first.questions.find((q) => q.type === 'single_select')!
    const changed = input.questions.find((q) => q.question === single.question)!
    changed.answers.forEach((a) => {
      a.correct = !a.correct
    })
    const importer = new ImportService(repository)
    importer.confirm(input, importer.preview(input).token, true)
    now += 8 * 86400000
    assert.deepEqual(service.due(options), {
      total: 20,
      eligible: 19,
      excluded: 0,
      unavailable: 1,
      oldestDay: '2026-10-27',
    })
    assert.deepEqual(service.get(first.id).questions, result.questions)
    const review = service.start({ ...options, mode: 'review' })
    assert.equal(review.total, 19)
    assert.ok(review.questions.every((q) => q.question !== single.question))
    assert.throws(() => service.due({ ...options, sourceIds: [] }), /Select at least/)
  } finally {
    repository.close()
  }
})
