import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { LibraryRepository } from '../src/server/questions/library-repository.ts'
import { PrivateLibraries } from '../src/server/questions/private-libraries.ts'
import { ImportService } from '../src/server/importer/import-service.ts'
import { QuizService } from '../src/server/quizzes/quiz-service.ts'
import { bank } from './fixtures.ts'

test('existing study evidence moves to its owner file without copying shared content or other accounts', () => {
  const directory = mkdtempSync(join(tmpdir(), 'private-study-migration-'))
  const shared = new LibraryRepository(join(directory, 'shared.sqlite3'))
  const alice = randomUUID()
  const bob = randomUUID()
  try {
    const input = bank()
    input.questions = Array.from({ length: 20 }, (_, index) => ({
      ...structuredClone(input.questions[0]!),
      source_ref: String(index),
      question: `Migration synthetic question ${index}?`,
    }))
    const importer = new ImportService(shared)
    importer.confirm(input, importer.preview(input).token, false)
    const owner = shared.forAccount(alice)
    const quiz = new QuizService(owner).start({
      provider: 'Example',
      certification: 'DEMO-1',
      sourceFilter: 'mixed',
      questionType: 'mixed',
    })
    new QuizService(owner).pause(quiz.id)
    owner.quizStore().record('legacy-mastered-question', false)
    owner
      .certificationStore()
      .setEarned({ provider: 'Example', code: 'DEMO-1', name: 'Demo' }, true)
    shared.forAccount(bob).quizStore().record('other-account-question', true)
    const saved = owner.quizStore().find(quiz.id)
    const revision = shared.revision()
    const libraries = new PrivateLibraries(join(directory, 'users'))
    const destination = libraries.open(alice)
    destination.close()
    shared.moveStudyTo(join(directory, 'users', `${alice}.sqlite3`), alice)
    const migrated = libraries.open(alice)
    try {
      assert.deepEqual(migrated.quizStore().find(quiz.id), saved)
      assert.equal(migrated.certificationStore().all().length, 1)
      assert.equal(migrated.allQuestions().length, 0)
      assert.equal(owner.quizStore().find(quiz.id), undefined)
      assert.equal(owner.certificationStore().all().length, 0)
      assert.equal(shared.allQuestions().length, 20)
      assert.equal(shared.revision(), revision)
      assert.equal(
        readFileSync(join(directory, 'shared.sqlite3')).includes(Buffer.from(quiz.id)),
        false,
        'The old file must not retain deleted attempt data in reusable SQLite pages',
      )
      shared.moveStudyTo(join(directory, 'users', `${alice}.sqlite3`), alice)
      assert.deepEqual(migrated.quizStore().find(quiz.id), saved)
      assert.equal(shared.forAccount(bob).quizStore().boosts().size, 0)
    } finally {
      migrated.close()
    }
  } finally {
    shared.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('a failed transfer rolls back both files and refuses to merge conflicting histories', () => {
  const directory = mkdtempSync(join(tmpdir(), 'private-study-rollback-'))
  const sourcePath = join(directory, 'shared.sqlite3')
  const shared = new LibraryRepository(sourcePath)
  const accountId = randomUUID()
  const destinationPath = join(directory, 'users', `${accountId}.sqlite3`)
  const libraries = new PrivateLibraries(join(directory, 'users'))
  try {
    const owner = shared.forAccount(accountId)
    owner.quizStore().record('preserve-on-failure', false)
    owner
      .certificationStore()
      .setEarned({ provider: 'Example', code: 'DEMO-1', name: 'Demo' }, true)
    libraries.open(accountId).close()
    const injected = new DatabaseSync(destinationPath)
    injected.exec(`
      CREATE TRIGGER reject_certification BEFORE INSERT ON earned_certifications
      BEGIN SELECT RAISE(ABORT, 'synthetic transfer failure'); END;
    `)
    injected.close()
    assert.throws(
      () => shared.moveStudyTo(destinationPath, accountId),
      /synthetic transfer failure/,
    )
    const check = new DatabaseSync(destinationPath)
    assert.equal(check.prepare('SELECT count(*) AS total FROM quiz_mastery').get()?.total, 0)
    assert.equal(owner.certificationStore().all().length, 1)
    check.exec('DROP TRIGGER reject_certification')
    check
      .prepare('INSERT INTO quiz_mastery VALUES (?, ?, ?, ?)')
      .run(accountId, 'other-evidence', 0, 1)
    check.close()
    assert.throws(
      () => shared.moveStudyTo(destinationPath, accountId),
      /already contains study evidence/,
    )
    const source = new DatabaseSync(sourcePath, { readOnly: true })
    assert.equal(
      source
        .prepare('SELECT count(*) AS total FROM quiz_mastery WHERE account_id = ?')
        .get(accountId)?.total,
      1,
    )
    source.close()
    const otherId = randomUUID()
    libraries.open(otherId).close()
    assert.throws(
      () => shared.moveStudyTo(join(directory, 'users', `${otherId}.sqlite3`), accountId),
      /selected account/,
    )
  } finally {
    shared.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('migration refuses WAL mode before moving any study evidence', () => {
  const directory = mkdtempSync(join(tmpdir(), 'private-study-wal-'))
  const sourcePath = join(directory, 'shared.sqlite3')
  const shared = new LibraryRepository(sourcePath)
  const accountId = randomUUID()
  const libraries = new PrivateLibraries(join(directory, 'users'))
  try {
    shared.forAccount(accountId).quizStore().record('preserve-wal', false)
    libraries.open(accountId).close()
    const setup = new DatabaseSync(sourcePath)
    setup.exec('PRAGMA journal_mode = WAL')
    setup.close()
    assert.throws(
      () => shared.moveStudyTo(join(directory, 'users', `${accountId}.sqlite3`), accountId),
      /DELETE journal mode/,
    )
    const source = new DatabaseSync(sourcePath, { readOnly: true })
    assert.equal(source.prepare('SELECT count(*) AS total FROM quiz_mastery').get()?.total, 1)
    source.close()
  } finally {
    shared.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
