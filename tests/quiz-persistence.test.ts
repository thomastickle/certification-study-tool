import { prepareRuntimeDatabase } from './managed-database-fixture.ts'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LibraryRepository } from '../src/server/questions/library-repository.ts'
import { QuizService } from '../src/server/quizzes/quiz-service.ts'
import { ImportService } from '../src/server/importer/import-service.ts'
import { LibraryService } from '../src/server/questions/library-service.ts'
import { bank } from './fixtures.ts'
import { populate } from './quiz-fixtures.ts'

test('prepared library preserves IDs/content; saved results survive reopen and source deletion', () => {
  const directory = mkdtempSync(join(tmpdir(), 'quiz-history-'))
  const path = join(directory, 'library.sqlite3')
  prepareRuntimeDatabase(path)
  try {
    let repository = new LibraryRepository(path)
    populate(repository)
    const original = repository.allQuestions()
    repository.close()
    // The external admin suite owns v1 conversion assertions. Runtime exercises the prepared result.
    repository = new LibraryRepository(path)
    assert.deepEqual(repository.allQuestions(), original)
    const importer = new ImportService(repository)
    const pending = bank('pending')
    const preview = importer.preview(pending)
    const service = new QuizService(
      repository,
      () => 1000,
      () => 0.3,
    )
    const quiz = service.start({ sourceFilter: 'mixed', questionType: 'mixed' })
    const answers = quiz.questions.map((q) => ({
      questionId: q.questionId,
      selected: [],
      confidence: null,
      flagged: false,
    }))
    const result = service.submit(quiz.id, { answers })
    // Quiz writes do not invalidate unrelated library import previews.
    importer.confirm(pending, preview.token, false)
    for (const source of repository.sources())
      new LibraryService(repository).deleteSource(source.id)
    assert.equal(repository.questions().total, 0)
    repository.close()
    repository = new LibraryRepository(path)
    try {
      // Bank deletion adds provenance; every original answer, score and timing field survives.
      assert.deepEqual(new QuizService(repository, () => 1000).get(quiz.id), {
        ...result,
        deletedBankNames: ['quiz-synthetic'],
      })
      assert.equal(new QuizService(repository).recent().length, 1)
      assert.equal(repository.quizStore().boosts().size, 0)
    } finally {
      repository.close()
    }
  } finally {
    rmSync(directory, { recursive: true })
  }
})

test('paused snapshot and remaining time survive database close and reopen', () => {
  const directory = mkdtempSync(join(tmpdir(), 'quiz-pause-'))
  const path = join(directory, 'library.sqlite3')
  prepareRuntimeDatabase(path)
  let repository = new LibraryRepository(path)
  try {
    populate(repository)
    let now = 1000
    const service = new QuizService(repository, () => now)
    const quiz = service.start({ sourceFilter: 'mixed', questionType: 'mixed' })
    now += 60_000
    const paused = service.pause(quiz.id)
    repository.close()
    repository = new LibraryRepository(path)
    now += 24 * 60 * 60_000
    const restarted = new QuizService(repository, () => now)
    restarted.expireDue()
    assert.equal(restarted.current('quiz')?.status, 'paused')
    assert.equal(restarted.resume(quiz.id).deadline - now, quiz.deadline - paused.pausedAt!)
    assert.equal(repository.quizStore().boosts().size, 0)
  } finally {
    repository.close()
    rmSync(directory, { recursive: true })
  }
})
