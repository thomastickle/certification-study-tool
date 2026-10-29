-- Current schema at cdf94cff. Flyway owns the surrounding transaction.
CREATE TABLE certification_schema (version INTEGER PRIMARY KEY CHECK (version = 1));

CREATE TABLE concept_schema (version INTEGER PRIMARY KEY CHECK (version = 1));

CREATE TABLE deleted_sources (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        source_id INTEGER NOT NULL UNIQUE,
        provider TEXT NOT NULL,
        certification TEXT NOT NULL,
        name TEXT NOT NULL,
        kind TEXT NOT NULL
      );

CREATE TABLE dismissed_concept_suggestions (id TEXT PRIMARY KEY);

CREATE TABLE "earned_certifications" (
        account_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        code TEXT NOT NULL,
        name TEXT NOT NULL,
        PRIMARY KEY (account_id, provider, code)
      );

CREATE TABLE library_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        revision INTEGER NOT NULL
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

CREATE TABLE quiz_evidence (
      account_id TEXT NOT NULL,
      id TEXT NOT NULL,
      version INTEGER NOT NULL,
      provider TEXT,
      certification TEXT,
      payload TEXT NOT NULL,
      checksum TEXT NOT NULL,
      PRIMARY KEY (account_id, id)
    );

CREATE TABLE "quiz_mastery" (
        account_id TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        boosted INTEGER NOT NULL,
        correct_streak INTEGER NOT NULL,
        PRIMARY KEY (account_id, fingerprint)
      );

CREATE TABLE "quiz_sessions" (
        account_id TEXT NOT NULL,
        id TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        data TEXT NOT NULL,
        PRIMARY KEY (account_id, id)
      );

CREATE TABLE reviewed_concepts (
      id TEXT PRIMARY KEY, provider TEXT NOT NULL, certification TEXT NOT NULL,
      name TEXT NOT NULL, normalized_name TEXT NOT NULL, identities TEXT NOT NULL,
      UNIQUE(provider, certification, normalized_name)
    );

CREATE TABLE shared_deletion_cursor (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        sequence INTEGER NOT NULL
      );

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

CREATE INDEX questions_fingerprint ON questions(fingerprint);

CREATE INDEX quiz_sessions_status ON "quiz_sessions"(status, account_id);

CREATE TRIGGER quiz_evidence_delete AFTER DELETE ON quiz_sessions BEGIN
      DELETE FROM quiz_evidence WHERE account_id = OLD.account_id AND id = OLD.id;
    END;

CREATE TRIGGER quiz_evidence_insert AFTER INSERT ON quiz_sessions BEGIN
      DELETE FROM quiz_evidence WHERE account_id = NEW.account_id AND id = NEW.id;
    END;

CREATE TRIGGER quiz_evidence_update AFTER UPDATE ON quiz_sessions BEGIN
      DELETE FROM quiz_evidence WHERE account_id = OLD.account_id AND id = OLD.id;
      DELETE FROM quiz_evidence WHERE account_id = NEW.account_id AND id = NEW.id;
    END;

INSERT INTO library_state VALUES (1, 0);
INSERT INTO shared_deletion_cursor VALUES (1, 0);
INSERT INTO concept_schema VALUES (1);
INSERT INTO certification_schema VALUES (1);


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

-- External conversion completes all study transfers before publishing central readiness.
CREATE TABLE private_study_separation (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  complete INTEGER NOT NULL CHECK (complete IN (0, 1))
);
INSERT INTO private_study_separation VALUES (1, 1);
PRAGMA application_id = 1096242006;
PRAGMA user_version = 1;
