import { prepareRuntimeDatabase } from './managed-database-fixture.ts'
import { prepareManagedDatabase } from './managed-database-fixture.ts'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LibraryRepository } from '../src/server/questions/library-repository.ts'
import { QuizService } from '../src/server/quizzes/quiz-service.ts'
import { ReportService } from '../src/server/reports/report-service.ts'
import { HomeService } from '../src/server/home/home-service.ts'
import { populate } from './quiz-fixtures.ts'

const options = { sourceFilter: 'mixed', questionType: 'mixed' }
const twoDays = 48 * 60 * 60 * 1000

test('pending deletion excludes a result from all study evidence; undo restores the saved attempt', () => {
  const repository = new LibraryRepository(prepareManagedDatabase())
  try {
    populate(repository)
    let now = Date.UTC(2026, 9, 21, 12)
    const service = new QuizService(
      repository,
      () => now,
      () => 0.3,
    )
    const attempt = service.start(options)
    const result = service.submit(attempt.id, {
      answers: attempt.questions.map((q) => ({
        questionId: q.questionId,
        selected: [q.answers.at(-1)!.id],
        confidence: 'Unsure',
        flagged: true,
      })),
    })
    const reports = new ReportService(repository, () => now)
    const home = new HomeService(repository, () => now)
    const beforeReport = reports.get()
    const beforeDue = service.due(options)
    const beforeHome = home.get()
    assert.equal(beforeReport.attempts.length, 1)
    assert.ok(repository.quizStore().boosts().size > 0)
    const sources = repository.sources()
    const deleted = service.deleteResult(attempt.id)
    assert.equal(deleted?.deletedAt, now)
    assert.equal(deleted?.purgeAt, now + twoDays)
    now += 1000
    assert.equal(service.deleteResult(attempt.id)?.purgeAt, deleted?.purgeAt)
    assert.deepEqual(service.recent(), [])
    assert.equal(reports.get().attempts.length, 0)
    assert.equal(reports.get().counts.total, 0)
    assert.equal(service.due(options).total, 0)
    assert.equal(home.get().providers[0]!.certifications[0]!.dueCount, 0)
    assert.equal(repository.quizStore().boosts().size, 0)
    assert.throws(() => service.get(attempt.id), /not found/)
    assert.equal(service.deletedResults().length, 1)
    assert.deepEqual(service.deletedResults({ provider: 'Other', certification: 'EXAM' }), [])
    service.abandon(attempt.id)
    assert.equal(service.deletedResults().length, 1)
    now = deleted!.purgeAt - 1
    service.restoreResult(attempt.id)
    assert.equal(service.get(attempt.id).finishedAt, result.finishedAt)
    assert.deepEqual(service.get(attempt.id).questions, result.questions)
    assert.deepEqual(service.deletedResults(), [])
    now = result.serverNow
    assert.deepEqual(reports.get(), beforeReport)
    assert.deepEqual(service.due(options), beforeDue)
    assert.deepEqual(home.get(), beforeHome)
    assert.deepEqual(repository.sources(), sources)
  } finally {
    repository.close()
  }
})

test('deletion rejects unfinished attempts, expires at exactly 48 hours, and permits early permanent deletion', () => {
  const repository = new LibraryRepository(prepareManagedDatabase())
  try {
    populate(repository)
    let now = 1000
    const service = new QuizService(repository, () => now)
    const first = service.start(options)
    assert.throws(() => service.deleteResult(first.id), /completed/)
    assert.throws(() => service.deleteResult(first.id, true), /completed/)
    service.pause(first.id)
    assert.throws(() => service.deleteResult(first.id), /completed/)
    service.resume(first.id)
    service.submit(first.id, {
      answers: first.questions.map((q) => ({
        questionId: q.questionId,
        selected: [],
        confidence: null,
        flagged: false,
      })),
    })
    assert.throws(() => service.restoreResult(first.id), /pending deletion/)
    const deleted = service.deleteResult(first.id)!
    now = deleted.purgeAt
    assert.throws(() => service.restoreResult(first.id), /not found/)
    assert.equal(repository.quizStore().find(first.id), undefined)
    assert.equal(service.deleteResult(first.id), null)
    const second = service.start(options)
    service.submit(second.id, {
      answers: second.questions.map((q) => ({
        questionId: q.questionId,
        selected: [],
        confidence: null,
        flagged: false,
      })),
    })
    service.deleteResult(second.id)
    assert.equal(service.deleteResult(second.id, true), null)
    assert.throws(() => service.restoreResult(second.id), /not found/)
    assert.deepEqual(service.deletedResults(), [])
  } finally {
    repository.close()
  }
})

test('pending deletions survive restart and source removal; expiry purges only deleted results', () => {
  const directory = mkdtempSync(join(tmpdir(), 'quiz-deletion-'))
  const path = join(directory, 'library.sqlite3')
  prepareRuntimeDatabase(path)
  let repository = new LibraryRepository(path)
  let now = 1000
  try {
    populate(repository)
    let service = new QuizService(repository, () => now)
    const ids: string[] = []
    for (let index = 0; index < 3; index++) {
      const quiz = service.start(options)
      service.submit(quiz.id, {
        answers: quiz.questions.map((q) => ({
          questionId: q.questionId,
          selected: [],
          confidence: null,
          flagged: false,
        })),
      })
      ids.push(quiz.id)
    }
    const original = service.get(ids[0]!)
    service.deleteResult(ids[0]!)
    service.deleteResult(ids[1]!)
    for (const source of repository.sources()) {
      repository.deleteSource(source.id)
    }
    repository.close()
    repository = new LibraryRepository(path)
    service = new QuizService(repository, () => now)
    assert.equal(service.deletedResults().length, 2)
    service.restoreResult(ids[0]!)
    assert.deepEqual(service.get(ids[0]!).questions, original.questions)
    assert.equal(repository.questions().total, 0)
    now += twoDays
    service.expireDue()
    assert.deepEqual(service.deletedResults(), [])
    assert.equal(repository.quizStore().find(ids[1]!), undefined)
    assert.deepEqual(new Set(service.recent().map((quiz) => quiz.id)), new Set([ids[0], ids[2]]))
  } finally {
    repository.close()
    rmSync(directory, { recursive: true })
  }
})
