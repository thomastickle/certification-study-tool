-- Read-only legacy validation contract. Never execute against an input database.
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
