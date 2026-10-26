import type { DatabaseSync } from 'node:sqlite'

/** Retain shared-bank deletion events so private histories can reconcile without cross-user writes. */
export function migrateLibraryVisibility(db: DatabaseSync): void {
  if (Number(db.prepare('PRAGMA user_version').get()?.user_version) !== 3) {
    return
  }
  db.exec('BEGIN IMMEDIATE')
  try {
    db.exec(`
      CREATE TABLE deleted_sources (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        source_id INTEGER NOT NULL UNIQUE,
        provider TEXT NOT NULL,
        certification TEXT NOT NULL,
        name TEXT NOT NULL,
        kind TEXT NOT NULL
      );
      CREATE TABLE shared_deletion_cursor (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        sequence INTEGER NOT NULL
      );
      INSERT INTO shared_deletion_cursor VALUES (1, 0);
      PRAGMA user_version = 4;
      COMMIT;
    `)
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}
