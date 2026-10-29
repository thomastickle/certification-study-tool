import { existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

/** Prepare fresh synthetic files only. Existing files are never adopted or upgraded. */
export function prepareManagedDatabase(path = ':memory:', owner?: string): DatabaseSync {
  if (path !== ':memory:') {
    if (existsSync(path)) {
      throw new Error('Synthetic fixture target already exists.')
    }
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  }
  const db = new DatabaseSync(path)
  try {
    const catalog = owner ? 'personal' : 'central'
    db.exec(
      readFileSync(
        new URL(`../database/migrations/${catalog}/V1__current_schema.sql`, import.meta.url),
        'utf8',
      ),
    )
    // Explicit test-only history simulation; external integration tests use real Flyway.
    db.exec(`CREATE TABLE flyway_schema_history (
      installed_rank INTEGER PRIMARY KEY, version TEXT, success INTEGER NOT NULL
    ); INSERT INTO flyway_schema_history VALUES (1, '1', 1);`)
    if (owner) {
      db.prepare('INSERT INTO private_library_owner(singleton, account_id) VALUES (1, ?)').run(
        owner,
      )
    }
    return db
  } catch (error) {
    db.close()
    throw error
  }
}
