import { existsSync, mkdirSync, chmodSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
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
      installed_rank INTEGER PRIMARY KEY, version TEXT, type TEXT, script TEXT, success INTEGER NOT NULL
    ); INSERT INTO flyway_schema_history VALUES (1, '1', 'SQL', 'V1__current_schema.sql', 1);`)
    if (owner) {
      db.prepare('INSERT INTO private_library_owner(singleton, account_id) VALUES (1, ?)').run(
        owner,
      )
    }
    if (path !== ':memory:') {
      chmodSync(path, 0o600)
    }
    db.exec('PRAGMA foreign_keys = ON')
    return db
  } catch (error) {
    db.close()
    throw error
  }
}

/** Publish a synthetic deployment before constructing a runtime. */
export function prepareRuntimeDatabase(path: string): void {
  prepareManagedDatabase(path).close()
  writeFileSync(join(dirname(path), 'READY'), '1\n', { mode: 0o600, flag: 'wx' })
}

/** Simulate the external provision job after the harness has verified account mapping. */
export function provisionTestWorkspace(central: string, directory: string, owner: string): void {
  const db = new DatabaseSync(central, { readOnly: true })
  try {
    if (!db.prepare('SELECT id FROM accounts WHERE id = ?').get(owner)) {
      throw new Error('Synthetic workspace requires an existing verified account.')
    }
  } finally {
    db.close()
  }
  const path = join(directory, `${owner}.sqlite3`)
  if (!existsSync(path)) {
    prepareManagedDatabase(path, owner).close()
  }
}

/** Prepare explicitly selected synthetic personal files for repository-only tests. */
export function preparePersonalFixtures(
  directory: string,
  owners: readonly string[],
  root = directory,
): void {
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  if (!existsSync(join(root, 'READY'))) {
    writeFileSync(join(root, 'READY'), '1\n', { flag: 'wx', mode: 0o600 })
  }
  for (const owner of owners) {
    prepareManagedDatabase(join(directory, `${owner}.sqlite3`), owner).close()
  }
}
