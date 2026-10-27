import assert from 'node:assert/strict'
import { test } from 'node:test'
import { LibraryRepository } from '../src/server/questions/library-repository.ts'
import { QuizService } from '../src/server/quizzes/quiz-service.ts'
import { populate } from './quiz-fixtures.ts'
import { assertHistoryEvidence, snapshotDigest } from './benchmark-history-evidence.ts'

test('benchmark evidence rejects equal-count replacement, changed evidence and wrong source annotations', () => {
  const repository = new LibraryRepository(':memory:')
  try {
    populate(repository)
    const service = new QuizService(repository, Date.now, () => 0.5)
    const view = service.start({ sourceFilter: 'mixed', questionType: 'mixed' })
    service.submit(view.id, { answers: view.questions })
    const quiz = repository.quizStore().find(view.id)!
    const originals = new Map([[quiz.id, snapshotDigest(quiz)]])
    const deleted = new Map([[1, 'shared-marker']])
    quiz.deletedBankNames = ['shared-marker']
    assertHistoryEvidence([quiz], originals, deleted)
    assert.throws(
      () => assertHistoryEvidence([{ ...quiz, id: 'other-owner' }], originals, deleted),
      /identities/,
    )
    assert.throws(
      () => assertHistoryEvidence([{ ...quiz, correctCount: 999 }], originals, deleted),
      /evidence/,
    )
    assert.throws(
      () =>
        assertHistoryEvidence(
          [{ ...quiz, deletedBankNames: ['private-marker'] }],
          originals,
          deleted,
        ),
      /deleted sources/,
    )
    assert.throws(
      () =>
        assertHistoryEvidence(
          [{ ...quiz, deletedBankNames: ['shared-marker', 'private-marker'] }],
          originals,
          deleted,
        ),
      /deleted sources/,
    )
    assert.throws(
      () => assertHistoryEvidence([{ ...quiz, deletedBankNames: [] }], originals, deleted),
      /deleted sources/,
    )
  } finally {
    repository.close()
  }
})
