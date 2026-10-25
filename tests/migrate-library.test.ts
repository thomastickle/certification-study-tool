import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { AccountRepository } from '../src/server/auth/account-repository.ts'
import { LibraryRepository } from '../src/server/questions/library-repository.ts'
import { QuizService } from '../src/server/quizzes/quiz-service.ts'
import { migrateLibrary } from '../src/server/auth/migrate-library.ts'
import { populate } from './quiz-fixtures.ts'
import { StudyApplication } from '../src/server/auth/study-application.ts'
import { ImportService } from '../src/server/importer/import-service.ts'
import { bank } from './fixtures.ts'
import { spawnSync } from 'node:child_process'

test('migration previews without writes, preserves full study history, and keeps an original backup', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'study-migrate-'))
  try {
    mkdirSync(join(directory, 'users'))
    const accounts = new AccountRepository(join(directory, 'accounts.sqlite3'))
    const alice = accounts.identify({
      issuer: 'http://127.0.0.1:8080/realms/study',
      subject: 'alice',
      name: 'Alice',
    })
    accounts.close()
    const legacyPath = join(directory, 'library.sqlite3')
    const legacy = new LibraryRepository(legacyPath)
    populate(legacy)
    const quizzes = new QuizService(legacy)
    const quiz = quizzes.start({ sourceFilter: 'mixed', questionType: 'mixed' })
    quizzes.submit(quiz.id, {
      answers: quiz.questions.map((question) => ({
        questionId: question.questionId,
        selected: [],
        confidence: 'Unsure',
        flagged: false,
      })),
    })
    legacy
      .certificationStore()
      .setEarned({ provider: 'AWS', code: 'CLF-C02', name: 'Cloud Practitioner' }, true)
    legacy.close()
    const original = readFileSync(legacyPath)
    const target = join(directory, 'users', alice.id + '.sqlite3')
    // Normal first login creates an empty workspace; importing into it must be supported.
    new LibraryRepository(target).close()
    const empty = readFileSync(target)
    const preview = await migrateLibrary({ dataDirectory: directory, accountId: alice.id })
    assert.equal(preview.applied, false)
    assert.deepEqual(readFileSync(target), empty)
    assert.deepEqual(readFileSync(legacyPath), original)
    assert.equal(existsSync(join(directory, 'backups')), false)
    const result = await migrateLibrary({
      dataDirectory: directory,
      accountId: alice.id,
      apply: true,
    })
    assert.equal(result.applied, true)
    assert.ok(result.backup)
    assert.deepEqual(readFileSync(legacyPath), original)
    const migrated = new LibraryRepository(target)
    try {
      assert.equal(migrated.allQuestions().length, 48)
      assert.equal(migrated.quizStore().find(quiz.id)?.status, 'completed')
      assert.equal(migrated.certificationStore().all().length, 1)
    } finally {
      migrated.close()
    }
    const backup = new DatabaseSync(result.backup, { readOnly: true })
    try {
      assert.equal(backup.prepare('SELECT count(*) AS total FROM questions').get()?.total, 48)
    } finally {
      backup.close()
    }
    await assert.rejects(
      migrateLibrary({ dataDirectory: directory, accountId: alice.id, apply: true }),
      /not empty/,
    )
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

/** Small independent libraries make destructive-boundary failures easy to detect. */
function migrationFixture() {
  const directory = mkdtempSync(join(tmpdir(), 'study-migrate-guard-'))
  mkdirSync(join(directory, 'users'))
  const accounts = new AccountRepository(join(directory, 'accounts.sqlite3'))
  const alice = accounts.identify({
    issuer: 'http://127.0.0.1:8080/realms/study',
    subject: 'alice',
    name: 'Alice',
  })
  const bob = accounts.identify({
    issuer: 'http://127.0.0.1:8080/realms/study',
    subject: 'bob',
    name: 'Bob',
  })
  accounts.close()
  const source = join(directory, 'library.sqlite3')
  const legacy = new LibraryRepository(source)
  const importer = new ImportService(legacy)
  const input = bank()
  importer.confirm(input, importer.preview(input).token, false)
  legacy.close()
  const target = join(directory, 'users', alice.id + '.sqlite3')
  new LibraryRepository(target).close()
  const other = join(directory, 'users', bob.id + '.sqlite3')
  new LibraryRepository(other).close()
  return {
    directory,
    source,
    target,
    other,
    alice,
    close: () => rmSync(directory, { recursive: true, force: true }),
  }
}

test('migration refuses a running application and releases its lock after refusal', async () => {
  const fixture = migrationFixture()
  const app = new StudyApplication({
    dataDirectory: fixture.directory,
    origin: new URL('http://127.0.0.1:3000'),
    issuer: new URL('http://127.0.0.1:8080/realms/study'),
    clientId: 'study-tool',
  })
  try {
    await assert.rejects(
      migrateLibrary({
        dataDirectory: fixture.directory,
        accountId: fixture.alice.id,
        apply: true,
      }),
      /in use/,
    )
  } finally {
    app.close()
  }
  try {
    const preview = await migrateLibrary({
      dataDirectory: fixture.directory,
      accountId: fixture.alice.id,
    })
    assert.equal(preview.applied, false)
  } finally {
    fixture.close()
  }
})

test('unknown accounts, unsafe IDs and unrelated source databases cannot alter a workspace', async () => {
  const fixture = migrationFixture()
  try {
    const before = readFileSync(fixture.target)
    await assert.rejects(
      migrateLibrary({ dataDirectory: fixture.directory, accountId: '../outside', apply: true }),
      /valid account ID/,
    )
    await assert.rejects(
      migrateLibrary({
        dataDirectory: fixture.directory,
        accountId: '00000000-0000-0000-0000-000000000000',
        apply: true,
      }),
      /does not exist/,
    )
    await assert.rejects(
      migrateLibrary({
        dataDirectory: fixture.directory,
        accountId: fixture.alice.id,
        source: join(fixture.directory, 'accounts.sqlite3'),
        apply: true,
      }),
      /recognized study database/,
    )
    assert.deepEqual(readFileSync(fixture.target), before)
    assert.equal(existsSync(join(fixture.directory, 'backups')), false)
  } finally {
    fixture.close()
  }
})

test('migration preserves other users and refuses non-library history in a destination', async () => {
  const fixture = migrationFixture()
  try {
    const before = readFileSync(fixture.other)
    const target = new LibraryRepository(fixture.target)
    target
      .certificationStore()
      .setEarned({ provider: 'Example', code: 'DEMO-1', name: 'Existing earned credential' }, true)
    target.close()
    const used = readFileSync(fixture.target)
    await assert.rejects(
      migrateLibrary({
        dataDirectory: fixture.directory,
        accountId: fixture.alice.id,
        apply: true,
      }),
      /not empty/,
    )
    assert.deepEqual(readFileSync(fixture.target), used)
    assert.deepEqual(readFileSync(fixture.other), before)
  } finally {
    fixture.close()
  }
})

test('SQLite backup includes committed legacy WAL records without changing another user', async () => {
  const fixture = migrationFixture()
  const writer = new DatabaseSync(fixture.source)
  try {
    writer.exec(
      "PRAGMA journal_mode=WAL; INSERT INTO earned_certifications VALUES ('Example', 'WAL', 'Committed in WAL')",
    )
    assert.equal(existsSync(fixture.source + '-wal'), true)
    const other = readFileSync(fixture.other)
    await migrateLibrary({
      dataDirectory: fixture.directory,
      accountId: fixture.alice.id,
      apply: true,
    })
    const target = new LibraryRepository(fixture.target)
    try {
      assert.equal(target.certificationStore().all()[0]?.code, 'WAL')
    } finally {
      target.close()
    }
    assert.deepEqual(readFileSync(fixture.other), other)
  } finally {
    writer.close()
    fixture.close()
  }
})

test('the migration CLI lists real accounts and defaults to a read-only preview', () => {
  const fixture = migrationFixture()
  try {
    const args = ['src/server/auth/migrate-library-cli.ts', '--data-dir', fixture.directory]
    const list = spawnSync(process.execPath, [...args, '--list-accounts'], { encoding: 'utf8' })
    assert.equal(list.status, 0, list.stderr)
    assert.equal(
      JSON.parse(list.stdout).some((account: { id: string }) => account.id === fixture.alice.id),
      true,
    )
    const before = readFileSync(fixture.target)
    const preview = spawnSync(process.execPath, [...args, '--account-id', fixture.alice.id], {
      encoding: 'utf8',
    })
    assert.equal(preview.status, 0, preview.stderr)
    assert.equal(JSON.parse(preview.stdout).applied, false)
    assert.deepEqual(readFileSync(fixture.target), before)
  } finally {
    fixture.close()
  }
})
