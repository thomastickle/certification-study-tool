import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'
import { LibraryRepository } from '../src/server/questions/library-repository.ts'
import { PrivateLibraries } from '../src/server/questions/private-libraries.ts'
import { QuizService } from '../src/server/quizzes/quiz-service.ts'
import { convert, preflight } from '../scripts/database-admin.ts'
import { createLegacyLibrary, prepareHistoricalAccounts } from './legacy-database-fixture.ts'
import { populate } from './quiz-fixtures.ts'
import { legacyStudySchema } from './legacy-study-schema.ts'

/** Recreate deployed unowned tables around real domain snapshots and question identities. */
function legacyStudyDatabase(path: string) {
  const repository = createLegacyLibrary(path)
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
  const mastery = repository.quizStore().boosts()
  repository.close()
  const db = new DatabaseSync(path)
  try {
    db.exec(legacyStudySchema)
  } finally {
    db.close()
  }
  return { saved, questions, revision, mastery }
}

test('legacy history stays unclaimed until external conversion verifies an explicit owner', async () => {
  const root = mkdtempSync(join(tmpdir(), 'study-owner-conversion-'))
  const alice = randomUUID()
  const bob = randomUUID()
  const shared = join(root, 'shared.sqlite3')
  const accounts = join(root, 'accounts.sqlite3')
  const fleet = join(root, 'old-users')
  const destination = join(root, 'converted')
  try {
    const original = legacyStudyDatabase(shared)
    prepareHistoricalAccounts(accounts, [alice, bob])
    mkdirSync(fleet, { mode: 0o700 })
    const before = readFileSync(shared)
    const authBefore = readFileSync(accounts)
    const options = { shared, accounts, fleet, destination }
    for (const legacyOwner of [undefined, '', ' ', randomUUID()]) {
      assert.throws(() => preflight({ ...options, legacyOwner }), /explicit verified account owner/)
      assert.deepEqual(readFileSync(shared), before)
      assert.deepEqual(readFileSync(accounts), authBefore)
      assert.equal(existsSync(destination), false)
      const unchanged = new DatabaseSync(shared, { readOnly: true })
      assert.equal(unchanged.prepare('PRAGMA user_version').get()?.user_version, 2)
      assert.equal(unchanged.prepare('SELECT count(*) AS n FROM quiz_sessions').get()?.n, 1)
      unchanged.close()
    }
    await convert({ ...options, legacyOwner: alice }, true)
    const central = new LibraryRepository(join(destination, 'central.sqlite3'))
    try {
      assert.deepEqual(central.allQuestions(), original.questions)
      assert.equal(central.revision(), original.revision)
      assert.deepEqual(central.quizStore().snapshots(), [])
    } finally {
      central.close()
    }
    const libraries = new PrivateLibraries(join(destination, 'users'))
    const owner = libraries.open(alice)
    try {
      assert.deepEqual(owner.quizStore().find(original.saved.id), original.saved)
      assert.deepEqual(owner.quizStore().boosts(), original.mastery)
      assert.equal(owner.certificationStore().all().length, 1)
    } finally {
      owner.close()
    }
    const other = libraries.open(bob)
    try {
      assert.deepEqual(other.quizStore().snapshots(), [])
      assert.deepEqual(other.certificationStore().all(), [])
      assert.equal(other.quizStore().find(original.saved.id), undefined)
    } finally {
      other.close()
    }
    const reopened = new PrivateLibraries(join(destination, 'users')).open(alice)
    assert.deepEqual(reopened.quizStore().find(original.saved.id), original.saved)
    reopened.close()
    assert.deepEqual(readFileSync(shared), before)
    assert.deepEqual(readFileSync(accounts), authBefore)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a legacy version marker cannot reassign already account-owned records', () => {
  const root = mkdtempSync(join(tmpdir(), 'study-owner-schema-'))
  const path = join(root, 'shared.sqlite3')
  const accounts = join(root, 'accounts.sqlite3')
  const fleet = join(root, 'old-users')
  const destination = join(root, 'converted')
  const alice = randomUUID()
  const bob = randomUUID()
  try {
    prepareHistoricalAccounts(accounts, [alice, bob])
    mkdirSync(fleet, { mode: 0o700 })
    const shared = createLegacyLibrary(path)
    populate(shared)
    const options = { sourceFilter: 'mixed', questionType: 'mixed' }
    const first = new QuizService(shared.forAccount(alice)).start(options)
    const second = new QuizService(shared.forAccount(bob)).start(options)
    shared.close()
    const malformed = new DatabaseSync(path)
    malformed.exec('DROP INDEX quiz_sessions_status; PRAGMA user_version = 2')
    malformed.close()
    const before = readFileSync(path)
    assert.throws(
      () => preflight({ accounts, shared: path, fleet, destination, legacyOwner: alice }),
      /ownership schema/,
    )
    assert.equal(existsSync(destination), false)
    assert.deepEqual(readFileSync(path), before)
    const unchanged = new DatabaseSync(path, { readOnly: true })
    try {
      const rows = unchanged
        .prepare('SELECT account_id, id FROM quiz_sessions ORDER BY account_id')
        .all()
      assert.deepEqual(
        rows.map((row) => [row.account_id, row.id]),
        [
          [alice, first.id],
          [bob, second.id],
        ].sort((a, b) => a[0]!.localeCompare(b[0]!)),
      )
    } finally {
      unchanged.close()
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
