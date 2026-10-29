import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { LibraryView } from '../src/server/questions/library-repository.ts'
import { PrivateLibraries } from '../src/server/questions/private-libraries.ts'
import { prepareManagedDatabase } from './managed-database-fixture.ts'

/** Create only a fresh historical fixture; never repair or upgrade an existing file. */
export function prepareHistoricalDatabase(
  path: string,
  kind: 'accounts' | 'shared' | 'personal',
  owner?: string,
): void {
  if (existsSync(path)) {
    throw new Error('Historical fixture target already exists.')
  }
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const db = new DatabaseSync(path)
  try {
    db.exec(
      readFileSync(
        new URL(`../dev/flyway/${kind}/V1__current_schema.sql`, import.meta.url),
        'utf8',
      ),
    )
    if (owner) {
      db.prepare('INSERT INTO private_library_owner VALUES (1, ?)').run(owner)
    }
  } finally {
    db.close()
  }
  chmodSync(path, 0o600)
}

/** Test-only domain access to an explicitly prepared historical file, without runtime validation bypasses. */
export class LegacyLibraryFixture extends LibraryView {
  private fixtureDatabase: DatabaseSync
  private closed = false

  constructor(path: string, account = 'local') {
    if (!existsSync(path)) {
      throw new Error('Prepare the historical fixture explicitly first.')
    }
    const db = new DatabaseSync(path)
    db.exec('PRAGMA foreign_keys = ON')
    super({ db, transactionDepth: 0 }, account)
    this.fixtureDatabase = db
  }

  /** Release the fixture connection before external administration or filesystem cleanup. */
  close(): void {
    if (!this.closed) {
      this.fixtureDatabase.close()
      this.closed = true
    }
  }
}

/** Explicitly prepare a new legacy domain fixture; reopening never invokes schema preparation. */
export function createLegacyLibrary(path: string, account = 'local'): LegacyLibraryFixture {
  prepareHistoricalDatabase(path, 'shared')
  return new LegacyLibraryFixture(path, account)
}

/** Test-only provisioning, distinct from ordinary runtime open; existing files are never repaired. */
export function provisionAndOpenFixture(directory: string, owner: string) {
  const path = join(directory, `${owner}.sqlite3`)
  if (!existsSync(path)) {
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    prepareManagedDatabase(path, owner).close()
    chmodSync(path, 0o600)
    writeFileSync(join(directory, 'READY'), '1\n', { mode: 0o600 })
    writeFileSync(join(dirname(directory), 'READY'), '1\n', { mode: 0o600 })
  }
  return new PrivateLibraries(directory).open(owner)
}

/** Register explicit canonical identities in a fresh deployed accounts-v2 fixture. */
export function prepareHistoricalAccounts(path: string, owners: string[]): void {
  prepareHistoricalDatabase(path, 'accounts')
  const db = new DatabaseSync(path)
  try {
    for (const owner of owners) {
      db.prepare('INSERT INTO accounts VALUES (?, ?, ?, ?)').run(
        owner,
        'https://issuer.invalid',
        owner,
        owner,
      )
    }
  } finally {
    db.close()
  }
}

/** Materialize a fixed deployed v3 study layout for tests; this is not a production upgrade path. */
export function materializeOwnedLegacyFixture(db: DatabaseSync, owner: string): void {
  const tables = {
    quiz_sessions: {
      columns: 'id, status, started_at, data',
      schema:
        'id TEXT NOT NULL, status TEXT NOT NULL, started_at INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY (account_id, id)',
    },
    quiz_mastery: {
      columns: 'fingerprint, boosted, correct_streak',
      schema:
        'fingerprint TEXT NOT NULL, boosted INTEGER NOT NULL, correct_streak INTEGER NOT NULL, PRIMARY KEY (account_id, fingerprint)',
    },
    earned_certifications: {
      columns: 'provider, code, name',
      schema:
        'provider TEXT NOT NULL, code TEXT NOT NULL, name TEXT NOT NULL, PRIMARY KEY (account_id, provider, code)',
    },
  }
  db.exec('BEGIN IMMEDIATE')
  try {
    for (const [table, { columns, schema }] of Object.entries(tables)) {
      db.exec(
        `ALTER TABLE ${table} RENAME TO fixture_unowned_${table}; CREATE TABLE ${table} (account_id TEXT NOT NULL, ${schema})`,
      )
      db.prepare(`INSERT INTO ${table} SELECT ?, ${columns} FROM fixture_unowned_${table}`).run(
        owner,
      )
      db.exec(`DROP TABLE fixture_unowned_${table}`)
    }
    db.exec(
      'CREATE INDEX quiz_sessions_status ON quiz_sessions(status, account_id); PRAGMA user_version = 3; COMMIT',
    )
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

/** Emulate old cached evidence freed with secure_delete OFF at the cleanup failure boundary. */
export function leaveFreedStudyBytes(db: DatabaseSync, owner: string, attempt: string): void {
  const setting = Number(db.prepare('PRAGMA secure_delete').get()?.secure_delete)
  db.exec('PRAGMA secure_delete = OFF')
  try {
    db.prepare('INSERT INTO quiz_evidence VALUES (?, ?, 1, NULL, NULL, ?, ?)').run(
      owner,
      'discarded-fixture-cache',
      attempt.repeat(2048),
      'synthetic-cache',
    )
    db.prepare('DELETE FROM quiz_evidence WHERE id = ?').run('discarded-fixture-cache')
  } finally {
    db.exec(`PRAGMA secure_delete = ${setting === 2 ? 'FAST' : setting}`)
  }
}
