import { chmodSync, existsSync, lstatSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const preparation =
  'Database is not ready. Run external database preparation or conversion with npm run database:admin before starting the server; verify READY and resolve RESTART_BLOCKED.'

/** Validate externally managed format without repairing or migrating schema. */
export function validateManagedDatabase(db: DatabaseSync, owner?: string): void {
  try {
    inspectManagedDatabase(db, owner)
  } catch (cause) {
    throw new Error(preparation, { cause })
  }
}

/** Inspect the complete query contract without executing migration SQL. */
function inspectManagedDatabase(db: DatabaseSync, owner?: string): void {
  const applicationId = db.prepare('PRAGMA application_id').get()?.application_id
  const version = db.prepare('PRAGMA user_version').get()?.user_version
  if (applicationId !== (owner ? 1096242004 : 1096242006) || version !== (owner ? 4 : 1)) {
    throw new Error(preparation)
  }
  const history = db
    .prepare(
      'SELECT version, type, script, success FROM flyway_schema_history ORDER BY installed_rank DESC',
    )
    .all()
  if (
    history.length !== 1 ||
    history[0]?.version !== '1' ||
    history[0]?.type !== 'SQL' ||
    history[0]?.script !== 'V1__current_schema.sql' ||
    history[0]?.success !== 1
  ) {
    throw new Error(preparation)
  }
  if (!db.prepare('SELECT id, revision FROM library_state WHERE id = 1').get()) {
    throw new Error(preparation)
  }
  db.prepare(
    'SELECT id, source_id, reference, data, fingerprint, answer_key FROM questions LIMIT 0',
  ).all()
  db.prepare('SELECT account_id, id, status, started_at, data FROM quiz_sessions LIMIT 0').all()
  db.prepare(
    'SELECT account_id, id, version, provider, certification, payload, checksum FROM quiz_evidence LIMIT 0',
  ).all()
  for (const query of [
    'SELECT id, provider, certification, certification_name, source_key, name, kind, metadata FROM sources LIMIT 0',
    'SELECT account_id, fingerprint, boosted, correct_streak FROM quiz_mastery LIMIT 0',
    'SELECT account_id, provider, code, name FROM earned_certifications LIMIT 0',
    'SELECT id, provider, certification, name, normalized_name, identities FROM reviewed_concepts LIMIT 0',
    'SELECT id FROM dismissed_concept_suggestions LIMIT 0',
    'SELECT sequence, source_id, provider, certification, name, kind FROM deleted_sources LIMIT 0',
    'SELECT singleton, sequence FROM shared_deletion_cursor LIMIT 0',
    'SELECT version FROM concept_schema LIMIT 0',
    'SELECT version FROM certification_schema LIMIT 0',
  ]) {
    db.prepare(query).all()
  }
  if (!db.prepare('SELECT sequence FROM shared_deletion_cursor WHERE singleton = 1').get()) {
    throw new Error(preparation)
  }
  for (const name of ['quiz_evidence_insert', 'quiz_evidence_update', 'quiz_evidence_delete']) {
    if (
      !db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = ?").get(name)
    ) {
      throw new Error(preparation)
    }
  }
  if (owner) {
    if (
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(owner) ||
      db.prepare('SELECT account_id FROM private_library_owner WHERE singleton = 1').get()
        ?.account_id !== owner
    ) {
      throw new Error('Private library owner does not match the selected account.')
    }
  } else {
    if (db.prepare("SELECT name FROM sqlite_master WHERE name = 'private_library_owner'").get()) {
      throw new Error(preparation)
    }
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

/** Require a real deployment root and an exact, externally published readiness marker. */
export function validateDeploymentRoot(root: string): void {
  try {
    requireRealDirectory(root)
    // lstat detects dangling symlinks as well as ordinary markers.
    try {
      lstatSync(join(root, 'RESTART_BLOCKED'))
      throw new Error(
        'Database maintenance is incomplete: RESTART_BLOCKED must be resolved externally.',
      )
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error
      }
    }
    const ready = lstatSync(join(root, 'READY'))
    if (
      !ready.isFile() ||
      ready.isSymbolicLink() ||
      readFileSync(join(root, 'READY'), 'utf8') !== '1\n'
    ) {
      throw new Error(preparation)
    }
  } catch (cause) {
    throw new Error(preparation, { cause })
  }
}

/** Reject unsafe files and maintenance gates before opening a writable connection. */
export function openManagedDatabase(
  path: string,
  owner?: string,
  root = dirname(path),
): DatabaseSync {
  validateDeploymentRoot(root)
  requireRealDirectory(dirname(path))
  if (!existsSync(path) || !lstatSync(path).isFile() || lstatSync(path).isSymbolicLink()) {
    throw new Error(preparation)
  }
  let probe: DatabaseSync | undefined
  try {
    probe = new DatabaseSync(path, { readOnly: true })
    validateManagedDatabase(probe, owner)
  } catch (cause) {
    throw new Error(preparation, { cause })
  } finally {
    probe?.close()
  }
  chmodSync(path, 0o600)
  const db = new DatabaseSync(path, { timeout: 5000 })
  try {
    db.exec('PRAGMA foreign_keys = ON')
    return db
  } catch (error) {
    db.close()
    throw error
  }
}

/** Refuse symlinked ancestors as well as a symlink at the selected directory itself. */
export function requireRealDirectory(path: string): void {
  let current = resolve(path)
  while (true) {
    const directory = lstatSync(current)
    if (directory.isSymbolicLink() || !directory.isDirectory()) {
      throw new Error(preparation)
    }
    const parent = dirname(current)
    if (parent === current) {
      return
    }
    current = parent
  }
}
