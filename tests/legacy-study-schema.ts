import { DatabaseSync } from 'node:sqlite'

/** Deployed Epic 1 study tables, reconstructed only inside disposable test databases. */
export const legacyStudySchema = `
  -- Derived evidence did not exist in the deployed preownership layout.
  DROP TRIGGER IF EXISTS quiz_evidence_insert;
  DROP TRIGGER IF EXISTS quiz_evidence_update;
  DROP TRIGGER IF EXISTS quiz_evidence_delete;
  DROP TABLE IF EXISTS quiz_evidence;
  DROP TABLE IF EXISTS deleted_sources;
  DROP TABLE IF EXISTS shared_deletion_cursor;
      BEGIN IMMEDIATE;
      ALTER TABLE quiz_sessions RENAME TO scoped_sessions;
      ALTER TABLE quiz_mastery RENAME TO scoped_mastery;
      ALTER TABLE earned_certifications RENAME TO scoped_earned;
      CREATE TABLE quiz_sessions (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        data TEXT NOT NULL
      );
      CREATE TABLE quiz_mastery (
        fingerprint TEXT PRIMARY KEY,
        boosted INTEGER NOT NULL,
        correct_streak INTEGER NOT NULL
      );
      CREATE TABLE earned_certifications (
        provider TEXT NOT NULL,
        code TEXT NOT NULL,
        name TEXT NOT NULL,
        PRIMARY KEY (provider, code)
      );
      INSERT INTO quiz_sessions SELECT id, status, started_at, data FROM scoped_sessions;
      INSERT INTO quiz_mastery SELECT fingerprint, boosted, correct_streak FROM scoped_mastery;
      INSERT INTO earned_certifications SELECT provider, code, name FROM scoped_earned;
      DROP TABLE scoped_sessions;
      DROP TABLE scoped_mastery;
      DROP TABLE scoped_earned;
      PRAGMA user_version = 2;
      COMMIT;
`

/** Deployed Epic 1 identity/session schema, before role snapshots were added. */
export const legacyAccountSchema = `
  BEGIN IMMEDIATE;
  CREATE TABLE accounts (
    id TEXT PRIMARY KEY,
    issuer TEXT NOT NULL,
    subject TEXT NOT NULL,
    name TEXT NOT NULL,
    UNIQUE(issuer, subject)
  );
  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id),
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX sessions_expiry ON sessions(expires_at);
  PRAGMA application_id = 1096242005;
  PRAGMA user_version = 1;
  COMMIT;
`

/** Historical fixtures need the staging cleanup metadata that Flyway supplies in production. */
export function prepareLegacyCleanupMarker(path: string): void {
  const db = new DatabaseSync(path)
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS private_study_separation (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        complete INTEGER NOT NULL CHECK (complete IN (0, 1))
      );
      INSERT OR IGNORE INTO private_study_separation VALUES (1, 1);
    `)
  } finally {
    db.close()
  }
}
