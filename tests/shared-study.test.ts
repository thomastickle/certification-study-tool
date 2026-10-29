import { prepareRuntimeDatabase } from './managed-database-fixture.ts'
import { prepareManagedDatabase } from './managed-database-fixture.ts'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { LibraryRepository } from '../src/server/questions/library-repository.ts'
import { QuizService } from '../src/server/quizzes/quiz-service.ts'
import { LibraryService } from '../src/server/questions/library-service.ts'
import { populate } from './quiz-fixtures.ts'

test('shared questions do not share attempts, mastery, or earned certifications', () => {
  const directory = mkdtempSync(join(tmpdir(), 'shared-study-'))
  const path = join(directory, 'library.sqlite3')
  prepareRuntimeDatabase(path)
  const alice = new LibraryRepository(path, 'alice')
  const bob = new LibraryRepository(path, 'bob')
  try {
    populate(alice)
    assert.equal(bob.allQuestions().length, alice.allQuestions().length)
    const quizzes = new QuizService(
      alice,
      () => 1000,
      () => 0.4,
    )
    const attempt = quizzes.start({ sourceFilter: 'mixed', questionType: 'mixed' })
    quizzes.submit(attempt.id, {
      answers: attempt.questions.map((question) => ({
        questionId: question.questionId,
        selected: [],
        confidence: null,
        flagged: false,
      })),
    })
    alice.certificationStore().setEarned({ provider: 'AWS', code: 'CLF-C02', name: 'Cloud' }, true)

    assert.equal(bob.quizStore().find(attempt.id), undefined)
    assert.deepEqual(bob.quizStore().completed(), [])
    assert.deepEqual(bob.quizStore().recent(), [])
    assert.deepEqual(bob.quizStore().boosts(), new Set())
    assert.deepEqual(bob.certificationStore().all(), [])
    assert.equal(alice.quizStore().completed().length, 1)
    assert.equal(alice.certificationStore().all().length, 1)
    assert.throws(() => new QuizService(bob).get(attempt.id), /not found/i)
  } finally {
    bob.close()
    alice.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('deleting shared content marks every account snapshot without exposing private history', () => {
  const directory = mkdtempSync(join(tmpdir(), 'shared-provenance-'))
  const path = join(directory, 'library.sqlite3')
  prepareRuntimeDatabase(path)
  const alice = new LibraryRepository(path, 'alice')
  const bob = new LibraryRepository(path, 'bob')
  try {
    populate(alice)
    const options = { sourceFilter: 'mixed', questionType: 'mixed' }
    const first = new QuizService(alice, () => 1000).start(options)
    const second = new QuizService(bob, () => 1000).start(options)
    const source = alice.sources()[0]!
    new LibraryService(alice).deleteSource(source.id)
    assert.deepEqual(alice.quizStore().find(first.id)?.deletedBankNames, [source.name])
    assert.deepEqual(bob.quizStore().find(second.id)?.deletedBankNames, [source.name])
    assert.equal(alice.quizStore().find(second.id), undefined)
    assert.equal(bob.quizStore().find(first.id), undefined)
  } finally {
    bob.close()
    alice.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('colliding attempt IDs stay isolated through pause, scoring, deletion and retention', () => {
  const shared = new LibraryRepository(prepareManagedDatabase())
  try {
    populate(shared)
    const alice = shared.forAccount('alice')
    const bob = shared.forAccount('bob')
    let now = 1000
    const aliceQuizzes = new QuizService(alice, () => now)
    const bobQuizzes = new QuizService(bob, () => now)
    const options = { sourceFilter: 'mixed', questionType: 'mixed' }
    const first = aliceQuizzes.start(options)
    const second = bobQuizzes.start(options)
    const bobCopy = bob.quizStore().find(second.id)!
    bob.quizStore().remove(second.id)
    bobCopy.id = first.id
    bob.quizStore().save(bobCopy)

    bobQuizzes.pause(first.id)
    assert.equal(bobQuizzes.get(first.id).status, 'paused')
    assert.equal(aliceQuizzes.get(first.id).status, 'active')
    bobQuizzes.resume(first.id)
    const answers = bobCopy.questions.map((question) => ({
      questionId: question.questionId,
      selected: [],
      confidence: null,
      flagged: false,
    }))
    bobQuizzes.submit(first.id, { answers })
    assert.equal(bob.quizStore().completed().length, 1)
    assert.equal(alice.quizStore().completed().length, 0)
    assert.equal(aliceQuizzes.get(first.id).status, 'active')
    bobQuizzes.deleteResult(first.id)
    assert.equal(bob.quizStore().deleted().length, 1)
    assert.equal(alice.quizStore().deleted().length, 0)
    now += 49 * 60 * 60_000
    bob.quizStore().purgeDeleted(now)
    assert.equal(bob.quizStore().find(first.id), undefined)
    assert.equal(alice.quizStore().find(first.id)?.status, 'active')
    assert.deepEqual(shared.pendingStudyAccounts(), ['alice'])
  } finally {
    shared.close()
  }
})
