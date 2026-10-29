import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { constants, DatabaseSync } from 'node:sqlite'
import {
  LegacyLibraryFixture,
  createLegacyLibrary,
  provisionAndOpenFixture,
  materializeOwnedLegacyFixture,
  prepareHistoricalAccounts,
  leaveFreedStudyBytes,
} from './legacy-database-fixture.ts'
import { convert, maintain } from '../scripts/database-admin.ts'
import { PrivateLibraries } from '../src/server/questions/private-libraries.ts'
import { ImportService } from '../src/server/importer/import-service.ts'
import { QuizService } from '../src/server/quizzes/quiz-service.ts'
import { bank } from './fixtures.ts'
import { legacyStudySchema, prepareLegacyCleanupMarker } from './legacy-study-schema.ts'
import { migratePrivateStudy } from '../database/tools/legacy/migrate-private-study.ts'
import {
  moveStudyTo,
  studyAccounts,
  transferFleet,
} from '../database/tools/legacy/transfer-fleet.ts'
import { populate } from './quiz-fixtures.ts'

/** Test setup supplies already prepared files; production provisioning belongs to the admin CLI. */
function transferFixtureFleet(source: string, directory: string): void {
  transferFleet(source, (owner) => {
    provisionAndOpenFixture(directory, owner).close()
    return join(directory, `${owner}.sqlite3`)
  })
}

test('secure-delete is restored even when SQLite refuses to detach the destination', () => {
  const directory = mkdtempSync(join(tmpdir(), 'private-study-detach-'))
  const sourcePath = join(directory, 'shared.sqlite3')
  const shared = createLegacyLibrary(sourcePath)
  prepareLegacyCleanupMarker(join(directory, 'shared.sqlite3'))
  const accountId = randomUUID()
  const destinationPath = join(directory, 'users', `${accountId}.sqlite3`)
  provisionAndOpenFixture(join(directory, 'users'), accountId).close()
  shared.forAccount(accountId).quizStore().record('restore-settings', false)
  const db = new DatabaseSync(sourcePath)
  try {
    db.exec('PRAGMA secure_delete = OFF')
    db.setAuthorizer((action) =>
      action === constants.SQLITE_DETACH ? constants.SQLITE_DENY : constants.SQLITE_OK,
    )
    assert.throws(() => migratePrivateStudy(db, destinationPath, accountId), /not authorized/)
    assert.equal(db.prepare('PRAGMA main.secure_delete').get()?.secure_delete, 0)
  } finally {
    db.setAuthorizer(null)
    db.close()
    shared.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('an interrupted source deletion recovers both files and retries without losing evidence', () => {
  const directory = mkdtempSync(join(tmpdir(), 'private-study-interruption-'))
  const sourcePath = join(directory, 'shared.sqlite3')
  let shared = createLegacyLibrary(sourcePath)
  const accountId = randomUUID()
  const destinationPath = join(directory, 'users', `${accountId}.sqlite3`)
  try {
    populate(shared)
    const owner = shared.forAccount(accountId)
    const quizzes = new QuizService(owner, () => 1000)
    const quiz = quizzes.start({ sourceFilter: 'mixed', questionType: 'mixed' })
    const saved = owner.quizStore().find(quiz.id)!
    saved.questions[0]!.selected = [saved.questions[0]!.answers[0]!.id]
    saved.questions[0]!.confidence = 'Confident'
    saved.questions[0]!.flagged = true
    owner.quizStore().save(saved)
    owner.quizStore().record('exact-mastery', true)
    owner.quizStore().record('exact-mastery', false)
    owner.certificationStore().setEarned({ provider: 'AWS', code: 'CLF-C02', name: 'Cloud' }, true)
    provisionAndOpenFixture(join(directory, 'users'), accountId).close()
    shared.close()
    const source = new DatabaseSync(sourcePath)
    const tables = ['quiz_sessions', 'quiz_mastery', 'earned_certifications']
    const before = tables.map((table) => source.prepare(`SELECT * FROM ${table}`).all())
    source.exec(`
      CREATE TABLE private_study_separation (
        singleton INTEGER PRIMARY KEY,
        complete INTEGER NOT NULL
      );
      INSERT INTO private_study_separation VALUES (1, 1);
      CREATE TRIGGER interrupt_deletion BEFORE DELETE ON earned_certifications
      BEGIN SELECT interrupt_transfer(); END;
    `)
    source.close()
    const migrationUrl = new URL(
      '../database/tools/legacy/migrate-private-study.ts',
      import.meta.url,
    )
    const child = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `import { DatabaseSync } from 'node:sqlite'
         import { migratePrivateStudy } from ${JSON.stringify(migrationUrl.href)}
         const db = new DatabaseSync(process.argv[1])
         db.function('interrupt_transfer', () => process.exit(23))
         migratePrivateStudy(db, process.argv[2], process.argv[3])`,
        sourcePath,
        destinationPath,
        accountId,
      ],
      { encoding: 'utf8', timeout: 10000 },
    )
    assert.equal(child.error, undefined)
    assert.equal(child.status, 23, child.stderr)
    const recovered = new DatabaseSync(sourcePath)
    const destination = new DatabaseSync(destinationPath)
    try {
      assert.deepEqual(
        tables.map((table) => recovered.prepare(`SELECT * FROM ${table}`).all()),
        before,
      )
      for (const table of tables) {
        assert.equal(destination.prepare(`SELECT count(*) AS total FROM ${table}`).get()?.total, 0)
      }
      assert.equal(
        recovered.prepare('SELECT complete FROM private_study_separation').get()?.complete,
        1,
      )
      recovered.exec('DROP TRIGGER interrupt_deletion')
    } finally {
      destination.close()
      recovered.close()
    }
    shared = new LegacyLibraryFixture(sourcePath)
    prepareLegacyCleanupMarker(join(directory, 'shared.sqlite3'))
    moveStudyTo(join(directory, 'shared.sqlite3'), destinationPath, accountId)
    const migrated = new DatabaseSync(destinationPath)
    try {
      assert.deepEqual(
        tables.map((table) => migrated.prepare(`SELECT * FROM ${table}`).all()),
        before,
      )
      assert.equal(
        migrated.prepare('SELECT account_id FROM private_library_owner').get()?.account_id,
        accountId,
      )
    } finally {
      migrated.close()
    }
    assert.deepEqual(studyAccounts(join(directory, 'shared.sqlite3')), [])
    moveStudyTo(join(directory, 'shared.sqlite3'), destinationPath, accountId)
  } finally {
    shared.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('a failed source deletion restores connection state and permits a retry on the same connection', () => {
  const directory = mkdtempSync(join(tmpdir(), 'private-study-cleanup-'))
  const sourcePath = join(directory, 'shared.sqlite3')
  const shared = createLegacyLibrary(sourcePath)
  prepareLegacyCleanupMarker(join(directory, 'shared.sqlite3'))
  const accountId = randomUUID()
  const destinationPath = join(directory, 'users', `${accountId}.sqlite3`)
  provisionAndOpenFixture(join(directory, 'users'), accountId).close()
  shared.forAccount(accountId).quizStore().record('retry-mastery', false)
  const db = new DatabaseSync(sourcePath)
  try {
    db.exec(`
      PRAGMA secure_delete = FAST;
      CREATE TRIGGER reject_deletion BEFORE DELETE ON quiz_mastery
      BEGIN SELECT RAISE(ABORT, 'synthetic deletion failure'); END;
    `)
    assert.throws(
      () => migratePrivateStudy(db, destinationPath, accountId),
      /synthetic deletion failure/,
    )
    assert.equal(db.prepare('PRAGMA main.secure_delete').get()?.secure_delete, 2)
    assert.deepEqual(
      db
        .prepare('PRAGMA database_list')
        .all()
        .map((row) => row.name),
      ['main'],
    )
    assert.equal(db.prepare('SELECT count(*) AS total FROM quiz_mastery').get()?.total, 1)
    db.exec('DROP TRIGGER reject_deletion')
    migratePrivateStudy(db, destinationPath, accountId)
    assert.equal(db.prepare('SELECT count(*) AS total FROM quiz_mastery').get()?.total, 0)
    assert.equal(db.prepare('PRAGMA main.secure_delete').get()?.secure_delete, 2)
    assert.deepEqual(
      db
        .prepare('PRAGMA database_list')
        .all()
        .map((row) => row.name),
      ['main'],
    )
  } finally {
    db.close()
    shared.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

for (const ambiguous of [false, true]) {
  test(`migration pins ${ambiguous ? 'ambiguous' : 'unique'} legacy provenance before source context is lost`, () => {
    const directory = mkdtempSync(join(tmpdir(), 'private-study-provenance-'))
    const shared = createLegacyLibrary(join(directory, 'shared.sqlite3'))
    prepareLegacyCleanupMarker(join(directory, 'shared.sqlite3'))
    const accountId = randomUUID()
    const libraries = new PrivateLibraries(join(directory, 'users'))
    try {
      const input = populate(shared)
      const owner = shared.forAccount(accountId)
      const quiz = new QuizService(owner, () => 1000).start({
        sourceFilter: 'mixed',
        questionType: 'mixed',
      })
      const saved = owner.quizStore().find(quiz.id)!
      for (const question of saved.questions) {
        delete question.sourceId
      }
      owner.quizStore().save(saved)
      if (ambiguous) {
        input.source.key = 'another-bank-with-the-same-name'
        const importer = new ImportService(shared)
        importer.confirm(input, importer.preview(input).token, false)
      }
      const expected = structuredClone(saved)
      for (const question of expected.questions) {
        question.sourceId = ambiguous ? null : shared.sources()[0]!.id
      }
      transferFixtureFleet(join(directory, 'shared.sqlite3'), join(directory, 'users'))
      const migrated = libraries.open(accountId)
      try {
        assert.deepEqual(migrated.quizStore().find(quiz.id), expected)
        assert.deepEqual(migrated.sources(), [])
      } finally {
        migrated.close()
      }
    } finally {
      shared.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })
}

for (const invalidDestination of [
  { name: 'WAL journaling', sql: 'PRAGMA journal_mode = WAL', error: /DELETE journal mode/ },
  { name: 'schema version', sql: 'PRAGMA user_version = 3', error: /selected account/ },
  { name: 'application ID', sql: 'PRAGMA application_id = 0', error: /selected account/ },
  { name: 'missing study table', sql: 'DROP TABLE quiz_mastery', error: /no such table/ },
]) {
  test(`migration rejects destination ${invalidDestination.name} without changing source evidence`, () => {
    const directory = mkdtempSync(join(tmpdir(), 'private-study-preconditions-'))
    const sourcePath = join(directory, 'shared.sqlite3')
    const shared = createLegacyLibrary(sourcePath)
    prepareLegacyCleanupMarker(join(directory, 'shared.sqlite3'))
    const accountId = randomUUID()
    const destinationPath = join(directory, 'users', `${accountId}.sqlite3`)
    try {
      shared.forAccount(accountId).quizStore().record('preserve-invalid-destination', false)
      provisionAndOpenFixture(join(directory, 'users'), accountId).close()
      const destination = new DatabaseSync(destinationPath)
      destination.exec(invalidDestination.sql)
      destination.close()
      const db = new DatabaseSync(sourcePath)
      try {
        const before = db.prepare('SELECT * FROM quiz_mastery').all()
        assert.throws(
          () => migratePrivateStudy(db, destinationPath, accountId),
          invalidDestination.error,
        )
        assert.deepEqual(db.prepare('SELECT * FROM quiz_mastery').all(), before)
        assert.deepEqual(
          db
            .prepare('PRAGMA database_list')
            .all()
            .map((row) => row.name),
          ['main'],
        )
      } finally {
        db.close()
      }
    } finally {
      shared.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })
}

test('a locked destination fails closed and can be retried after the other writer releases it', () => {
  const directory = mkdtempSync(join(tmpdir(), 'private-study-lock-'))
  const sourcePath = join(directory, 'shared.sqlite3')
  const shared = createLegacyLibrary(sourcePath)
  prepareLegacyCleanupMarker(join(directory, 'shared.sqlite3'))
  const accountId = randomUUID()
  const destinationPath = join(directory, 'users', `${accountId}.sqlite3`)
  provisionAndOpenFixture(join(directory, 'users'), accountId).close()
  shared.forAccount(accountId).quizStore().record('preserve-locked-destination', false)
  const otherWriter = new DatabaseSync(destinationPath)
  const db = new DatabaseSync(sourcePath)
  try {
    otherWriter.exec('BEGIN IMMEDIATE')
    assert.throws(() => migratePrivateStudy(db, destinationPath, accountId), /database is locked/)
    assert.equal(db.prepare('SELECT count(*) AS total FROM quiz_mastery').get()?.total, 1)
    assert.deepEqual(
      db
        .prepare('PRAGMA database_list')
        .all()
        .map((row) => row.name),
      ['main'],
    )
    otherWriter.exec('ROLLBACK')
    migratePrivateStudy(db, destinationPath, accountId)
    assert.equal(db.prepare('SELECT count(*) AS total FROM quiz_mastery').get()?.total, 0)
  } finally {
    db.close()
    otherWriter.close()
    shared.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('existing study evidence moves to its owner file without copying shared content or other accounts', () => {
  const directory = mkdtempSync(join(tmpdir(), 'private-study-migration-'))
  const shared = createLegacyLibrary(join(directory, 'shared.sqlite3'))
  prepareLegacyCleanupMarker(join(directory, 'shared.sqlite3'))
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
    const destination = provisionAndOpenFixture(join(directory, 'users'), alice)
    destination.close()
    moveStudyTo(
      join(directory, 'shared.sqlite3'),
      join(directory, 'users', `${alice}.sqlite3`),
      alice,
    )
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
        'The staging source must not retain deleted attempt data in reusable SQLite pages',
      )
      moveStudyTo(
        join(directory, 'shared.sqlite3'),
        join(directory, 'users', `${alice}.sqlite3`),
        alice,
      )
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
  const shared = createLegacyLibrary(sourcePath)
  prepareLegacyCleanupMarker(join(directory, 'shared.sqlite3'))
  const accountId = randomUUID()
  const destinationPath = join(directory, 'users', `${accountId}.sqlite3`)
  try {
    const owner = shared.forAccount(accountId)
    owner.quizStore().record('preserve-on-failure', false)
    owner
      .certificationStore()
      .setEarned({ provider: 'Example', code: 'DEMO-1', name: 'Demo' }, true)
    provisionAndOpenFixture(join(directory, 'users'), accountId).close()
    const injected = new DatabaseSync(destinationPath)
    injected.exec(`
      CREATE TRIGGER reject_certification BEFORE INSERT ON earned_certifications
      BEGIN SELECT RAISE(ABORT, 'synthetic transfer failure'); END;
    `)
    injected.close()
    assert.throws(
      () => moveStudyTo(join(directory, 'shared.sqlite3'), destinationPath, accountId),
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
      () => moveStudyTo(join(directory, 'shared.sqlite3'), destinationPath, accountId),
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
    provisionAndOpenFixture(join(directory, 'users'), otherId).close()
    assert.throws(
      () =>
        moveStudyTo(
          join(directory, 'shared.sqlite3'),
          join(directory, 'users', `${otherId}.sqlite3`),
          accountId,
        ),
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
  const shared = createLegacyLibrary(sourcePath)
  prepareLegacyCleanupMarker(join(directory, 'shared.sqlite3'))
  const accountId = randomUUID()
  try {
    shared.forAccount(accountId).quizStore().record('preserve-wal', false)
    provisionAndOpenFixture(join(directory, 'users'), accountId).close()
    const setup = new DatabaseSync(sourcePath)
    setup.exec('PRAGMA journal_mode = WAL')
    setup.close()
    assert.throws(
      () =>
        moveStudyTo(
          join(directory, 'shared.sqlite3'),
          join(directory, 'users', `${accountId}.sqlite3`),
          accountId,
        ),
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

for (const earlierOwnershipUpgrade of [false, true]) {
  test(`external conversion clears staged history bytes and preserves original v${earlierOwnershipUpgrade ? 3 : 2} input`, async (t) => {
    const directory = mkdtempSync(join(tmpdir(), 'private-study-freed-pages-'))
    const path = join(directory, 'shared.sqlite3')
    const accountId = randomUUID()
    const old = createLegacyLibrary(path)
    const input = bank()
    input.questions = Array.from({ length: 20 }, (_, index) => ({
      ...structuredClone(input.questions[0]!),
      source_ref: String(index),
      question: `Freed-page fixture ${index}?`,
    }))
    const importer = new ImportService(old)
    importer.confirm(input, importer.preview(input).token, false)
    const service = new QuizService(old)
    const ids: string[] = []
    for (let index = 0; index < 10; index++) {
      const quiz = service.start({
        provider: 'Example',
        certification: 'DEMO-1',
        sourceFilter: 'mixed',
        questionType: 'mixed',
      })
      service.submit(quiz.id, {
        answers: quiz.questions.map((question) => ({
          questionId: question.questionId,
          selected: [],
          confidence: null,
          flagged: false,
        })),
      })
      ids.push(quiz.id)
    }
    old.close()
    const legacy = new DatabaseSync(path)
    legacy.exec(legacyStudySchema)
    legacy.exec('VACUUM')
    if (earlierOwnershipUpgrade) {
      materializeOwnedLegacyFixture(legacy, accountId)
    }
    legacy.close()
    const accounts = join(directory, 'accounts.sqlite3')
    prepareHistoricalAccounts(accounts, [accountId])
    const fleet = join(directory, 'old-users')
    mkdirSync(fleet, { mode: 0o700 })
    const original = readFileSync(path)
    const originalAccounts = readFileSync(accounts)
    const options = {
      accounts,
      shared: path,
      fleet,
      destination: join(directory, 'converted'),
      legacyOwner: accountId,
    }
    try {
      if (earlierOwnershipUpgrade) {
        const failed = { ...options, destination: join(directory, 'interrupted') }
        const execute = DatabaseSync.prototype.exec
        t.mock.method(DatabaseSync.prototype, 'exec', function (this: DatabaseSync, sql: string) {
          if (sql === 'VACUUM') {
            leaveFreedStudyBytes(this, accountId, ids[0]!)
            throw new Error('Synthetic cleanup interruption')
          }
          return execute.call(this, sql)
        })
        try {
          await assert.rejects(convert(failed, true), /Synthetic cleanup interruption/)
        } finally {
          t.mock.restoreAll()
        }
        assert.equal(existsSync(join(failed.destination, 'RESTART_BLOCKED')), true)
        assert.equal(existsSync(join(failed.destination, 'READY')), false)
        const partial = join(failed.destination, 'central.sqlite3')
        assert.deepEqual(
          studyAccounts(partial),
          [],
          'Attached transfers commit before physical cleanup fails',
        )
        assert.ok(
          readFileSync(partial).includes(Buffer.from(ids[0]!)),
          'Interrupted cleanup retains deliberately seeded old free-page bytes',
        )
        const pending = new DatabaseSync(partial, { readOnly: true })
        assert.equal(
          pending.prepare('SELECT complete FROM private_study_separation').get()?.complete,
          0,
        )
        pending.close()
        const transferred = new DatabaseSync(
          join(failed.destination, 'users', `${accountId}.sqlite3`),
          { readOnly: true },
        )
        assert.equal(
          transferred
            .prepare("SELECT count(*) AS n FROM quiz_sessions WHERE status = 'completed'")
            .get()?.n,
          10,
        )
        transferred.close()
        await assert.rejects(convert(failed, true), /already exists/)
        assert.deepEqual(readFileSync(path), original)
      }
      await convert(options, true)
      const central = join(options.destination, 'central.sqlite3')
      assert.deepEqual(studyAccounts(central), [])
      for (const id of ids) {
        assert.equal(
          readFileSync(central).includes(Buffer.from(id)),
          false,
          'Published central must not retain attempt bytes',
        )
      }
      const personal = new PrivateLibraries(join(options.destination, 'users')).open(accountId)
      assert.equal(personal.quizStore().completed().length, 10)
      personal.close()
      const library = new (
        await import('../src/server/questions/library-repository.ts')
      ).LibraryRepository(central)
      assert.equal(library.sources().length, 1)
      library.close()
      await maintain(options.destination, true)
      assert.equal(existsSync(join(options.destination, 'RESTART_BLOCKED')), false)
      assert.deepEqual(
        readFileSync(path),
        original,
        'Conversion preserves original historical pages',
      )
      assert.deepEqual(readFileSync(accounts), originalAccounts)
    } finally {
      t.mock.restoreAll()
      rmSync(directory, { recursive: true, force: true })
    }
  })
}
