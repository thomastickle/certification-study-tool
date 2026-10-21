import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LibraryRepository } from '../src/server/questions/library-repository.ts'
import { LibraryService } from '../src/server/questions/library-service.ts'
import { ImportService } from '../src/server/importer/import-service.ts'
import { QuizService } from '../src/server/quizzes/quiz-service.ts'
import { ReportService } from '../src/server/reports/report-service.ts'
import { HomeService } from '../src/server/home/home-service.ts'
import { populate } from './quiz-fixtures.ts'
import { bank } from './fixtures.ts'
import { quizReport } from '../src/shared/quiz-report.ts'
import { studyReportMarkdown } from '../src/shared/report-export.ts'

test('bank deletion flags actual quiz/exam provenance without changing evidence, including after reimport and restart', () => {
  const directory = mkdtempSync(join(tmpdir(), 'bank-indicators-'))
  const path = join(directory, 'library.sqlite3')
  let repository = new LibraryRepository(path)
  const now = Date.parse('2026-10-21T12:00:00Z')
  try {
    const original = populate(repository, 24)
    const importer = new ImportService(repository)
    const unused = bank('unused-bank')
    unused.certification = original.certification
    importer.confirm(unused, importer.preview(unused).token, false)
    const sources = repository.sources()
    const originalId = sources.find((s) => s.name === original.source.name)!.id
    const unusedId = sources.find((s) => s.name === unused.source.name)!.id
    const quizzes = new QuizService(
      repository,
      () => now,
      () => 0.3,
    )
    const options = {
      sourceFilter: 'mixed',
      questionType: 'mixed',
      sourceIds: [originalId, unusedId],
    }
    const quiz = quizzes.start(options)
    assert.ok(quiz.questions.every((q) => q.sourceName === original.source.name))
    quizzes.submit(quiz.id, { answers: quiz.questions })
    const exam = quizzes.start({ ...options, mode: 'exam' })
    quizzes.pause(exam.id)
    const reportBefore = new ReportService(repository, () => now).get()
    const readinessBefore = new HomeService(repository, () => now).get().providers[0]!
      .certifications[0]!.readiness
    const library = new LibraryService(repository)
    library.deleteSource(unusedId)
    assert.deepEqual(quizzes.get(quiz.id).deletedBankNames ?? [], [])
    library.deleteSource(originalId)
    assert.deepEqual(quizzes.get(quiz.id).deletedBankNames, [original.source.name])
    assert.deepEqual(quizzes.get(exam.id).deletedBankNames, [original.source.name])
    assert.equal(quizzes.get(exam.id).status, 'paused')
    assert.deepEqual(quizzes.recent()[0]!.deletedBankNames, [original.source.name])
    const report = new ReportService(repository, () => now).get()
    assert.deepEqual(report.counts, reportBefore.counts)
    assert.deepEqual(report.unique, reportBefore.unique)
    assert.deepEqual(report.attempts[0]!.deletedBankNames, [original.source.name])
    assert.equal(report.deletedBankAttemptCount, 1)
    assert.match(quizReport(quizzes.get(quiz.id)), /Question bank deleted: quiz-synthetic/)
    assert.match(studyReportMarkdown(report, 'All time'), /Question bank deleted: quiz-synthetic/)
    assert.equal(
      new ReportService(repository, () => now).get({ mode: 'exam' }).deletedBankAttemptCount,
      0,
    )
    const track = new HomeService(repository, () => now).get().providers[0]!.certifications[0]!
    assert.equal(track.deletedBankAttemptCount, 1)
    assert.deepEqual(track.readiness, readinessBefore)
    quizzes.deleteResult(quiz.id)
    assert.deepEqual(quizzes.deletedResults()[0]!.deletedBankNames, [original.source.name])
    assert.equal(new HomeService(repository, () => now).get().providers.length, 0)
    importer.confirm(original, importer.preview(original).token, false)
    assert.notEqual(repository.sources()[0]!.id, originalId)
    repository.close()
    repository = new LibraryRepository(path)
    const restarted = new QuizService(repository, () => now)
    assert.deepEqual(restarted.restoreResult(quiz.id).deletedBankNames, [original.source.name])
    restarted.resume(exam.id)
    restarted.submit(exam.id, { answers: exam.questions })
    assert.equal(new ReportService(repository, () => now).get().deletedBankAttemptCount, 2)
    const fresh = restarted.start({ sourceFilter: 'mixed', questionType: 'mixed' })
    assert.deepEqual(fresh.deletedBankNames ?? [], [])
  } finally {
    repository.close()
    rmSync(directory, { recursive: true })
  }
})

test('legacy snapshots use unambiguous drawn provenance within their certification, including pending results', () => {
  const repository = new LibraryRepository(':memory:')
  try {
    populate(repository)
    const quizzes = new QuizService(repository, () => 1000)
    const quiz = quizzes.start({ sourceFilter: 'mixed', questionType: 'mixed' })
    quizzes.submit(quiz.id, { answers: quiz.questions })
    quizzes.deleteResult(quiz.id)
    const stored = repository.quizStore().find(quiz.id)!
    for (const question of stored.questions) {
      delete question.sourceId
    }
    repository.quizStore().save(stored)
    const foreign = structuredClone(stored)
    foreign.id = 'foreign'
    foreign.options = { ...foreign.options, provider: 'Other' }
    repository.quizStore().save(foreign)
    new LibraryService(repository).deleteSource(repository.sources()[0]!.id)
    assert.deepEqual(quizzes.restoreResult(quiz.id).deletedBankNames, ['quiz-synthetic'])
    assert.deepEqual(repository.quizStore().find('foreign')!.deletedBankNames ?? [], [])
  } finally {
    repository.close()
  }
})

test('ambiguous legacy banks never become attributed merely because another matching bank was deleted', () => {
  const repository = new LibraryRepository(':memory:')
  try {
    const input = populate(repository)
    const quizzes = new QuizService(repository, () => 1000)
    const quiz = quizzes.start({ sourceFilter: 'mixed', questionType: 'mixed' })
    quizzes.submit(quiz.id, { answers: quiz.questions })
    const stored = repository.quizStore().find(quiz.id)!
    for (const question of stored.questions) {
      delete question.sourceId
    }
    repository.quizStore().save(stored)
    input.source.key = 'same-name-different-bank'
    const importer = new ImportService(repository)
    importer.confirm(input, importer.preview(input).token, false)
    for (const source of repository.sources()) {
      new LibraryService(repository).deleteSource(source.id)
      assert.deepEqual(quizzes.get(quiz.id).deletedBankNames ?? [], [])
    }
  } finally {
    repository.close()
  }
})

test('mixed-bank attempts retain each deleted bank while unrelated certification results remain unmarked', () => {
  const repository = new LibraryRepository(':memory:')
  try {
    const input = populate(repository)
    input.source.key = 'second'
    input.source.name = 'Second synthetic bank'
    input.questions = input.questions.filter((question) =>
      /^d[34]-/.test(question.source_ref ?? ''),
    )
    input.questions.forEach((question) => {
      question.question += ' Second bank.'
    })
    const importer = new ImportService(repository)
    importer.confirm(input, importer.preview(input).token, false)
    for (const question of repository.allQuestions()) {
      if (question.sourceName === 'quiz-synthetic' && /^d[34]-/.test(question.reference)) {
        new LibraryService(repository).deleteQuestion(question.id)
      }
    }
    const quizzes = new QuizService(
      repository,
      () => 1000,
      () => 0.3,
    )
    const quiz = quizzes.start({ sourceFilter: 'mixed', questionType: 'mixed' })
    assert.equal(new Set(quiz.questions.map((q) => q.sourceId)).size, 2)
    quizzes.submit(quiz.id, { answers: quiz.questions })
    for (const source of repository.sources()) {
      new LibraryService(repository).deleteSource(source.id)
    }
    assert.deepEqual(
      new Set(quizzes.get(quiz.id).deletedBankNames),
      new Set(['quiz-synthetic', 'Second synthetic bank']),
    )
    assert.equal(new ReportService(repository, () => 1000).get().deletedBankAttemptCount, 1)
    assert.equal(
      new ReportService(repository, () => 1000).get({ provider: 'Other' }).deletedBankAttemptCount,
      0,
    )
  } finally {
    repository.close()
  }
})
