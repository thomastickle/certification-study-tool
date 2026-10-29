-- Read-only legacy validation contract. Never execute against an input database.
CREATE TABLE accounts (
        id TEXT PRIMARY KEY,
        issuer TEXT NOT NULL,
        subject TEXT NOT NULL,
        name TEXT NOT NULL,
        UNIQUE(issuer, subject)
      );

CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id), expires_at INTEGER NOT NULL);

CREATE INDEX sessions_expiry ON sessions(expires_at);
