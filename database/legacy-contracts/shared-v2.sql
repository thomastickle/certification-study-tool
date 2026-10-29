-- Read-only legacy validation contract. Never execute against an input database.
CREATE TABLE certification_schema (version INTEGER PRIMARY KEY CHECK (version = 1));

CREATE TABLE concept_schema (version INTEGER PRIMARY KEY CHECK (version = 1));

CREATE TABLE dismissed_concept_suggestions (id TEXT PRIMARY KEY);

CREATE TABLE earned_certifications (provider TEXT NOT NULL, code TEXT NOT NULL, name TEXT NOT NULL, PRIMARY KEY (provider, code));

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

CREATE TABLE quiz_mastery (fingerprint TEXT PRIMARY KEY, boosted INTEGER NOT NULL, correct_streak INTEGER NOT NULL);

CREATE TABLE quiz_sessions (id TEXT PRIMARY KEY, status TEXT NOT NULL, started_at INTEGER NOT NULL, data TEXT NOT NULL);

CREATE TABLE reviewed_concepts (
      id TEXT PRIMARY KEY, provider TEXT NOT NULL, certification TEXT NOT NULL,
      name TEXT NOT NULL, normalized_name TEXT NOT NULL, identities TEXT NOT NULL,
      UNIQUE(provider, certification, normalized_name)
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
