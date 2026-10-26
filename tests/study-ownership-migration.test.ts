import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'
import { LibraryRepository } from '../src/server/questions/library-repository.ts'
import { QuizService } from '../src/server/quizzes/quiz-service.ts'
import { populate } from './quiz-fixtures.ts'
import { legacyStudySchema } from './legacy-study-schema.ts'

/** Recreate the deployed single-owner schema around genuine content and saved study state. */
function legacyStudyDatabase(path: string) {
  const repository = new LibraryRepository(path)
  populate(repository)
  const quizzes = new QuizService(repository, () => 1000)
  const quiz = quizzes.start({ sourceFilter: 'mixed', questionType: 'mixed' })
  quizzes.submit(quiz.id, {
    answers: quiz.questions.map((question) => ({
      questionId: question.questionId,
      selected: [],
      confidence: null,
      flagged: false,
    })),
  })
  repository.quizStore().record('legacy-fingerprint', false)
  repository
    .certificationStore()
    .setEarned({ provider: 'AWS', code: 'CLF-C02', name: 'Cloud' }, true)
  const saved = repository.quizStore().find(quiz.id)!
  const questions = repository.allQuestions()
  const revision = repository.revision()
  repository.close()
  const db = new DatabaseSync(path)
  try {
    db.exec(legacyStudySchema)
  } finally {
    db.close()
  }
  return { saved, questions, revision }
}

test('legacy history stays unclaimed until an explicit nonempty owner is supplied', () => {
  const directory = mkdtempSync(join(tmpdir(), 'study-owner-upgrade-'))
  const path = join(directory, 'library.sqlite3')
  try {
    const original = legacyStudyDatabase(path)
    for (const owner of [undefined, ' ']) {
      assert.throws(() => {
        const unexpected = new LibraryRepository(path, 'bob', owner)
        unexpected.close()
      }, /explicit legacy owner/)
      const unchanged = new DatabaseSync(path, { readOnly: true })
      try {
        assert.equal(unchanged.prepare('PRAGMA user_version').get()?.user_version, 2)
        assert.equal(
          unchanged.prepare('SELECT count(*) AS total FROM quiz_sessions').get()?.total,
          1,
        )
      } finally {
        unchanged.close()
      }
    }
    const upgraded = new LibraryRepository(path, 'alice', 'alice')
    try {
      assert.deepEqual(upgraded.quizStore().find(original.saved.id), original.saved)
      assert.deepEqual(upgraded.allQuestions(), original.questions)
      assert.equal(upgraded.revision(), original.revision)
      assert.equal(upgraded.certificationStore().all().length, 1)
      const bob = upgraded.forAccount('bob')
      assert.deepEqual(bob.quizStore().snapshots(), [])
      assert.deepEqual(bob.certificationStore().all(), [])
    } finally {
      upgraded.close()
    }
    const reopened = new LibraryRepository(path, 'bob', 'bob')
    try {
      assert.equal(reopened.quizStore().find(original.saved.id), undefined)
      assert.deepEqual(
        reopened.forAccount('alice').quizStore().find(original.saved.id),
        original.saved,
      )
    } finally {
      reopened.close()
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('a legacy version marker cannot reassign already account-owned records', () => {
  const directory = mkdtempSync(join(tmpdir(), 'study-owner-schema-'))
  const path = join(directory, 'library.sqlite3')
  try {
    const shared = new LibraryRepository(path)
    const alice = shared.forAccount('alice')
    const bob = shared.forAccount('bob')
    populate(shared)
    const options = { sourceFilter: 'mixed', questionType: 'mixed' }
    const first = new QuizService(alice).start(options)
    const second = new QuizService(bob).start(options)
    shared.close()
    const malformed = new DatabaseSync(path)
    // Ownership validation must protect records independently of incidental index-name collisions.
    malformed.exec('DROP INDEX quiz_sessions_status; PRAGMA user_version = 2')
    malformed.close()
    assert.throws(() => {
      const unexpected = new LibraryRepository(path, 'alice', 'alice')
      unexpected.close()
    }, /already.*ownership|owned.*records|schema.*ownership/i)
    const unchanged = new DatabaseSync(path, { readOnly: true })
    try {
      const rows = unchanged
        .prepare('SELECT account_id, id FROM quiz_sessions ORDER BY account_id')
        .all()
      assert.deepEqual(
        rows.map((row) => [row.account_id, row.id]),
        [
          ['alice', first.id],
          ['bob', second.id],
        ],
      )
    } finally {
      unchanged.close()
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
