import { prepareManagedDatabase } from './managed-database-fixture.ts'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { LibraryRepository } from '../src/server/questions/library-repository.ts'
import { ImportService } from '../src/server/importer/import-service.ts'
import { QuizService } from '../src/server/quizzes/quiz-service.ts'
import { LibraryService } from '../src/server/questions/library-service.ts'
import { bank } from './fixtures.ts'

test('practice keeps colliding shared and private bank IDs distinct', () => {
  const shared = new LibraryRepository(prepareManagedDatabase())
  const privateLibrary = new LibraryRepository(prepareManagedDatabase())
  try {
    for (const [library, label] of [
      [shared, 'shared'],
      [privateLibrary, 'private'],
    ] as const) {
      const input = bank('same-key')
      input.questions = Array.from({ length: 20 }, (_, index) => ({
        ...structuredClone(input.questions[0]!),
        source_ref: String(index),
        question: `${label} synthetic question ${index}?`,
      }))
      const importer = new ImportService(library)
      importer.confirm(input, importer.preview(input).token, false)
    }
    // The account's study view must combine content, not copy banks into either database.
    const study = shared.forAccount('alice', privateLibrary)
    const sources = study.sources()
    assert.deepEqual(
      sources.map((source) => source.id),
      [1, 'private:1'],
    )
    const quiz = new QuizService(study)
    const options = {
      provider: 'Example',
      certification: 'DEMO-1',
      sourceFilter: 'mixed',
      questionType: 'mixed',
    }
    const own = quiz.start({ ...options, sourceIds: ['private:1'] })
    assert.ok(own.questions.every((question) => question.sourceId === 'private:1'))
    assert.ok(own.questions.every((question) => question.question.startsWith('private')))
    assert.equal(privateLibrary.forAccount('alice').quizStore().snapshots().length, 1)
    assert.deepEqual(shared.forAccount('alice').quizStore().snapshots(), [])
    const common = quiz.start({ ...options, sourceIds: [1] })
    assert.ok(common.questions.every((question) => question.sourceId === 1))
    assert.equal(shared.sources().length, 1)
    assert.equal(privateLibrary.sources().length, 1)
  } finally {
    shared.close()
    privateLibrary.close()
  }
})

test('private and shared deletions retain exact provenance in the owner’s saved attempts', () => {
  const shared = new LibraryRepository(prepareManagedDatabase())
  const personal = new LibraryRepository(prepareManagedDatabase())
  try {
    for (const [library, key] of [
      [shared, 'shared-bank'],
      [personal, 'private-bank'],
    ] as const) {
      const input = bank(key)
      input.questions = Array.from({ length: 20 }, (_, index) => ({
        ...structuredClone(input.questions[0]!),
        source_ref: String(index),
        question: `${key} ${index}?`,
      }))
      const importer = new ImportService(library)
      importer.confirm(input, importer.preview(input).token, false)
    }
    const study = shared.forAccount('alice', personal)
    const service = new QuizService(study)
    const options = {
      provider: 'Example',
      certification: 'DEMO-1',
      sourceFilter: 'mixed',
      questionType: 'mixed',
    }
    const own = service.start({ ...options, sourceIds: ['private:1'] })
    new LibraryService(personal, 'private').deleteSource(1)
    assert.deepEqual(study.quizStore().find(own.id)?.deletedBankNames, ['private-bank'])
    const answers = own.questions.map((question) => ({
      questionId: question.questionId,
      selected: [],
      confidence: null,
      flagged: false,
    }))
    service.submit(own.id, { answers })
    const common = service.start({ ...options, sourceIds: [1] })
    new LibraryService(shared).deleteSource(1)
    study.synchronizeDeletions()
    assert.deepEqual(service.get(common.id).deletedBankNames, ['shared-bank'])
    assert.deepEqual(service.get(own.id).deletedBankNames, ['private-bank'])
    assert.equal(service.get(own.id).questions.length, 20)
    const cursor = personal.sharedDeletionCursor()
    study.synchronizeDeletions()
    assert.equal(personal.sharedDeletionCursor(), cursor)
  } finally {
    shared.close()
    personal.close()
  }
})
