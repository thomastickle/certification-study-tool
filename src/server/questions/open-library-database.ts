import { DatabaseSync } from 'node:sqlite'
import { migrateConcepts } from '../concepts/concept-repository.ts'
import { migrateQuizzes } from '../quizzes/quiz-repository.ts'
import { migrateCertifications } from '../home/certification-repository.ts'
import { migrateStudyOwnership } from './study-schema.ts'
import { migrateLibraryVisibility } from './library-visibility-schema.ts'

export type LibraryOptions = { legacyOwnerId?: string; privateOwnerId?: string }

/**
 * Open and initialize a connection, retaining cleanup responsibility until ownership is transferred.
 * @throws {Error} For invalid ownership, unrecognized/unsupported databases, or SQLite initialization errors.
 */
export function openLibraryDatabase(
  path: string,
  accountId: string,
  options: LibraryOptions,
): DatabaseSync {
  const db = new DatabaseSync(path, { timeout: 5000 })
  try {
    initializeLibraryDatabase(db, accountId, options)
    return db
  } catch (error) {
    db.close()
    throw error
  }
}

/** Validate identity and format before applying the existing ordered schema upgrades. */
function initializeLibraryDatabase(
  db: DatabaseSync,
  accountId: string,
  options: LibraryOptions,
): void {
  db.exec('PRAGMA foreign_keys = ON')
  const privateMarker = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'private_library_owner'",
    )
    .get()
  if (privateMarker || options.privateOwnerId) {
    if (!options.privateOwnerId || options.privateOwnerId !== accountId) {
      throw new Error('A private library cannot be opened as the shared library.')
    }
    const owner = db
      .prepare('SELECT account_id FROM private_library_owner WHERE singleton = 1')
      .get()
    if (owner?.account_id !== options.privateOwnerId) {
      throw new Error('Private library owner does not match the selected account.')
    }
  }
  const version = db.prepare('PRAGMA user_version').get()?.user_version
  const appId = db.prepare('PRAGMA application_id').get()?.application_id
  const occupied =
    Number(
      db
        .prepare(
          "SELECT count(*) AS total FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
        )
        .get()?.total,
    ) > 0
  if ((version === 0 && occupied) || (version !== 0 && appId !== 1096242004)) {
    throw new Error('Unrecognized database. Use a separate application database.')
  }
  if (version !== 0 && version !== 1 && version !== 2 && version !== 3 && version !== 4) {
    throw new Error('Unsupported database version. Use a separate application database.')
  }
  if (version === 0) {
    db.exec(`
      BEGIN;
      CREATE TABLE library_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        revision INTEGER NOT NULL
      );
      INSERT INTO library_state VALUES (1, 0);
      CREATE TABLE sources (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        provider TEXT NOT NULL,
        certification TEXT NOT NULL,
        certification_name TEXT NOT NULL,
        source_key TEXT NOT NULL,
        name TEXT NOT NULL,
        kind TEXT NOT NULL,
        metadata TEXT NOT NULL,
        UNIQUE(provider, certification, source_key)
      );
      CREATE TABLE questions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_id INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
        reference TEXT NOT NULL,
        data TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        answer_key TEXT NOT NULL,
        UNIQUE(source_id, reference)
      );
      CREATE INDEX questions_fingerprint ON questions(fingerprint);
      PRAGMA application_id = 1096242004;
      PRAGMA user_version = 1;
      COMMIT;
    `)
  }
  migrateQuizzes(db)
  migrateConcepts(db)
  migrateCertifications(db)
  migrateStudyOwnership(db, options.legacyOwnerId)
  migrateLibraryVisibility(db)
}
