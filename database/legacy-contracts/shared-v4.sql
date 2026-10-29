-- Read-only legacy validation contract. Never execute against an input database.
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
