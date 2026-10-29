import { existsSync, lstatSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const preparation =
  'Database is not ready. Run external database preparation or conversion before starting the server.'

/** Validate externally managed format without repairing or migrating schema. */
export function validateManagedDatabase(db: DatabaseSync, owner?: string): void {
  const applicationId = db.prepare('PRAGMA application_id').get()?.application_id
  const version = db.prepare('PRAGMA user_version').get()?.user_version
  if (applicationId !== (owner ? 1096242004 : 1096242006) || version !== (owner ? 4 : 1)) {
    throw new Error(preparation)
  }
  const history = db
    .prepare(
      'SELECT version, success FROM flyway_schema_history WHERE version IS NOT NULL ORDER BY installed_rank DESC',
    )
    .all()
  if (history.length !== 1 || history[0]?.version !== '1' || history[0]?.success !== 1) {
    throw new Error(preparation)
  }
  db.prepare('SELECT id, revision FROM library_state').all()
  db.prepare(
    'SELECT id, source_id, reference, data, fingerprint, answer_key FROM questions LIMIT 0',
  ).all()
  db.prepare('SELECT account_id, id, status, started_at, data FROM quiz_sessions LIMIT 0').all()
  db.prepare(
    'SELECT account_id, id, version, provider, certification, payload, checksum FROM quiz_evidence LIMIT 0',
  ).all()
  if (owner) {
    if (
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(owner) ||
      db.prepare('SELECT account_id FROM private_library_owner WHERE singleton = 1').get()
        ?.account_id !== owner
    ) {
      throw new Error('Private library owner does not match the selected account.')
    }
  } else {
    db.prepare('SELECT id, issuer, subject, name FROM accounts LIMIT 0').all()
    db.prepare('SELECT token_hash, account_id, expires_at, role FROM sessions LIMIT 0').all()
    if (
      db.prepare('SELECT complete FROM private_study_separation WHERE singleton = 1').get()
        ?.complete !== 1
    ) {
      throw new Error(preparation)
    }
  }
}

/** Reject absent or unsafe files and maintenance gates before opening a writable connection. */
export function openManagedDatabase(path: string, owner?: string): DatabaseSync {
  if (existsSync(join(dirname(path), 'RESTART_BLOCKED'))) {
    throw new Error(
      'Database maintenance is incomplete: RESTART_BLOCKED must be resolved externally.',
    )
  }
  if (!existsSync(path) || !lstatSync(path).isFile() || lstatSync(path).isSymbolicLink()) {
    throw new Error(preparation)
  }
  const probe = new DatabaseSync(path, { readOnly: true })
  try {
    validateManagedDatabase(probe, owner)
  } finally {
    probe.close()
  }
  const db = new DatabaseSync(path, { timeout: 5000 })
  db.exec('PRAGMA foreign_keys = ON')
  return db
}
