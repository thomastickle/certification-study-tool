-- Current schema at cdf94cff. Flyway owns the surrounding transaction.
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
        expires_at INTEGER NOT NULL,
        role TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('admin', 'student'))
      );

CREATE INDEX sessions_expiry ON sessions(expires_at);
PRAGMA application_id = 1096242005;
PRAGMA user_version = 2;
