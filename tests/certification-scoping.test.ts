import assert from 'node:assert/strict'
import { test } from 'node:test'
import { LibraryRepository } from '../src/server/questions/library-repository.ts'
import { ImportService } from '../src/server/importer/import-service.ts'
import { QuizService } from '../src/server/quizzes/quiz-service.ts'
import { populate } from './quiz-fixtures.ts'

const scope = { provider: 'Example', certification: 'GEN-1' }
const filters = { sourceFilter: 'mixed', questionType: 'mixed' } as const

/** Import unclassified generic questions alongside the legacy CLF pool. */
function library(repository: LibraryRepository, size = 65) {
  const input = populate(repository)
  input.certification = { ...scope, code: scope.certification, name: 'Generic' }
  input.source.key = 'generic'
  input.source.name = 'Generic bank'
  input.questions = Array.from({ length: size }, (_, i) => {
    const question = structuredClone(input.questions[0]!)
    question.question = `Generic question ${i}?`
    question.source_ref = `g-${i}`
    delete question.source_metadata
    delete question.classification
    return question
  })
  const importer = new ImportService(repository)
  importer.confirm(input, importer.preview(input).token, false)
}

test('generic practice includes unclassified questions, persists scope, and isolates recovery', () => {
  const repository = new LibraryRepository(':memory:')
  try {
    library(repository)
    const service = new QuizService(repository)
    const legacy = service.start(filters)
    const generic = service.start({ ...filters, ...scope })
    assert.equal(service.get(legacy.id).status, 'active')
    service.pause(legacy.id)
    assert.equal(generic.total, 20)
    assert.ok(generic.questions.every((q) => q.sourceName === 'Generic bank' && q.domain === 0))
    assert.equal(generic.options.provider, scope.provider)
    assert.equal(service.current('quiz', scope)?.id, generic.id)
    assert.equal(service.current('quiz')?.id, legacy.id)
    const exam = service.start({ ...filters, ...scope, mode: 'exam' })
    assert.equal(exam.total, 65)
    assert.equal(new Set(exam.questions.map((q) => q.question)).size, 65)
    assert.equal(service.get(generic.id).status, 'active')
    assert.throws(() => service.start(filters), /paused/)
    const wrongSource = repository.sources().find((s) => s.provider === 'AWS')!
    assert.throws(
      () => service.start({ ...filters, ...scope, sourceIds: [wrongSource.id] }),
      /source/i,
    )
  } finally {
    repository.close()
  }
})

test('generic exams require enough unique eligible questions', () => {
  const repository = new LibraryRepository(':memory:')
  try {
    library(repository, 64)
    assert.throws(
      () => new QuizService(repository).start({ ...filters, ...scope, mode: 'exam' }),
      /65.*64/,
    )
  } finally {
    repository.close()
  }
})

test('mastery, due review, recent and reports stay scoped even after library deletion', async () => {
  const { ReportService } = await import('../src/server/reports/report-service.ts')
  const { LibraryService } = await import('../src/server/questions/library-service.ts')
  const repository = new LibraryRepository(':memory:')
  let now = Date.UTC(2026, 9, 1, 12)
  try {
    library(repository)
    const service = new QuizService(repository, () => now)
    for (const pair of [{}, scope]) {
      const quiz = service.start({ ...filters, ...pair })
      const stored = repository.quizStore().find(quiz.id)!
      service.submit(quiz.id, {
        answers: quiz.questions.map((q, i) => ({
          questionId: q.questionId,
          selected: stored.keys[i]!.correct,
          confidence: 'Confident',
          flagged: false,
        })),
      })
    }
    const foreign = structuredClone(
      repository
        .quizStore()
        .completed()
        .find((quiz) => quiz.options.provider === scope.provider)!,
    )
    foreign.id = 'foreign-history'
    foreign.options.provider = 'Other'
    foreign.questions.forEach((question) => {
      question.selected = [
        question.answers.find((answer) => !question.correctAnswerIds!.includes(answer.id))!.id,
      ]
      question.correct = false
    })
    repository.quizStore().save(foreign)
    const reports = new ReportService(repository, () => now)
    assert.equal(reports.get(scope).unique.mastered, 20)
    assert.equal(reports.get().unique.mastered, 20)
    assert.equal(reports.get(scope).certification, scope.certification)
    assert.deepEqual(
      reports.get(scope).domains.map((d) => d.name),
      ['Unclassified'],
    )
    assert.equal(reports.get(scope).counts.total, 20)
    assert.equal(service.recent(scope).length, 1)
    assert.equal(service.recent().length, 1)
    now += 8 * 86400000
    assert.equal(service.due({ ...filters, ...scope }).total, 20)
    assert.equal(service.due(filters).total, 20)
    const review = service.start({ ...filters, ...scope, mode: 'review' })
    assert.equal(review.total, 20)
    assert.ok(review.questions.every((q) => q.sourceName === 'Generic bank'))
    const genericSource = repository.sources().find((s) => s.provider === scope.provider)!
    new LibraryService(repository).deleteSource(genericSource.id)
    assert.deepEqual(service.due({ ...filters, ...scope }), {
      total: 20,
      eligible: 0,
      unavailable: 20,
      excluded: 0,
      oldestDay: '2026-10-08',
    })
    assert.equal(service.due(filters).unavailable, 0)
    assert.equal(reports.get(scope).unique.mastered, 20)
  } finally {
    repository.close()
  }
})

test('HTTP current, recent, due and reports honor the complete certification pair', async () => {
  const { createServer } = await import('node:http')
  const { apiTestHandler } = await import('./support/api-test-handler.ts')
  const repository = new LibraryRepository(':memory:')
  const server = createServer(apiTestHandler(repository, { id: 'local', role: 'admin' }))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const base = `http://127.0.0.1:${address.port}`
  const query = new URLSearchParams(scope)
  try {
    library(repository)
    const service = new QuizService(repository)
    const legacy = service.start(filters)
    const generic = service.start({ ...filters, ...scope })

    const get = async (path: string) => {
      const response = await fetch(`${base}${path}`)
      assert.equal(response.status, 200)
      return response.json()
    }

    assert.equal((await get(`/api/quizzes/current?${query}`)).id, generic.id)
    assert.equal((await get('/api/quizzes/current')).id, legacy.id)
    const stored = repository.quizStore().find(generic.id)!
    service.submit(generic.id, { answers: generic.questions })
    assert.deepEqual(
      (await get(`/api/quizzes?${query}`)).map((q: { id: string }) => q.id),
      [generic.id],
    )
    assert.deepEqual(await get('/api/quizzes'), [])
    assert.equal((await get(`/api/reports?${query}`)).counts.total, 20)
    assert.equal((await get(`/api/reports?${query}`)).provider, scope.provider)
    assert.equal((await get('/api/reports')).counts.total, 0)
    const otherProvider = {
      ...stored,
      id: 'other-provider',
      status: 'completed' as const,
      finishedAt: Date.now(),
      options: { ...stored.options, provider: 'Other' },
    }
    repository.quizStore().save(otherProvider)
    assert.equal((await get(`/api/reports?${query}`)).counts.total, 20)
    const historical = repository.quizStore().find(generic.id)!
    historical.startedAt -= 8 * 86400000
    historical.finishedAt! -= 8 * 86400000
    historical.questions.forEach((question, index) => {
      question.selected = historical.keys[index]!.correct
      question.correct = true
      question.confidence = 'Confident'
    })
    repository.quizStore().save(historical)
    assert.equal((await get(`/api/quizzes/due?${query}`)).total, 20)
    assert.equal((await get('/api/quizzes/due')).total, 0)
    for (const path of [
      '/api/reports?provider=',
      '/api/quizzes?certification=',
      '/api/quizzes/current?provider=',
      '/api/quizzes/due?provider=',
    ]) {
      assert.equal((await fetch(`${base}${path}`)).status, 400)
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    repository.close()
  }
})
