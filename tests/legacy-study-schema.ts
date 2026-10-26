/** Deployed Epic 1 study tables, reconstructed only inside disposable test databases. */
export const legacyStudySchema = `
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
