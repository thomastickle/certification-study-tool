import { randomUUID } from 'node:crypto'
import {
  closeSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { consistentBackup, rejectLinks, requireFile, validateCurrent } from './database-files.ts'

/**
 * Retain account IDs when the same operator-owned Keycloak realm receives its stable HTTPS URL.
 * @throws {Error} For unknown issuers, colliding subjects or failed writes; all row changes roll back.
 */
export function remapLocalIssuer(database: DatabaseSync, previous: string, next: string): number {
  if (previous === next) {
    return 0
  }
  database.exec('BEGIN IMMEDIATE')
  try {
    const foreign = database
      .prepare('SELECT 1 FROM accounts WHERE issuer NOT IN (?, ?) LIMIT 1')
      .get(previous, next)
    if (foreign) {
      throw new Error('Unknown identity issuer; no accounts were reassigned.')
    }
    const collision = database
      .prepare(
        `
      SELECT 1 FROM accounts original
      JOIN accounts destination ON destination.subject = original.subject
      WHERE original.issuer = ? AND destination.issuer = ? LIMIT 1
    `,
      )
      .get(previous, next)
    if (collision) {
      throw new Error('Identity subject collision; accounts must never be merged automatically.')
    }
    database
      .prepare(
        `
      DELETE FROM sessions WHERE account_id IN (
        SELECT id FROM accounts WHERE issuer = ?
      )
    `,
      )
      .run(previous)
    const result = database
      .prepare('UPDATE accounts SET issuer = ? WHERE issuer = ?')
      .run(next, previous)
    database.exec('COMMIT')
    return Number(result.changes)
  } catch (error) {
    if (database.isTransaction) {
      database.exec('ROLLBACK')
    }
    throw error
  }
}

/**
 * Flush the restart gate and directory entries before changing persistent identity records.
 */
function flush(path: string): void {
  const descriptor = openSync(path, 'r')
  try {
    fsyncSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
}

/**
 * Back up a stopped managed central database before the one-time identity URL transition.
 * @throws {Error} For unsafe/unready storage or a failed cutover; failures retain the restart gate.
 */
export async function adoptNetworkIssuer(
  central: string,
  previous: string,
  next: string,
  offline: boolean,
): Promise<void> {
  if (!offline) {
    throw new Error('Stop all application and CLI writers and acknowledge --offline.')
  }
  rejectLinks(central)
  const root = dirname(central)
  const ready = join(root, 'READY')
  requireFile(ready)
  if (readFileSync(ready, 'utf8') !== '1\n') {
    throw new Error('Deployment is not ready.')
  }
  const gate = join(root, 'RESTART_BLOCKED')
  try {
    lstatSync(gate)
    throw new Error('An existing restart gate requires operator recovery.')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error
    }
  }
  validateCurrent(central, 'central')
  const lock = join(root, 'maintenance.lock')
  const descriptor = openSync(lock, 'wx', 0o600)
  let completed = false
  try {
    writeFileSync(gate, 'Identity URL cutover incomplete. Keep writers stopped.\n', {
      flag: 'wx',
      mode: 0o600,
    })
    flush(gate)
    flush(root)
    const operation = randomUUID()
    const backup = join(root, `identity-backup-${operation}.sqlite3`)
    const journal = join(root, `identity-cutover-${operation}.json`)
    await consistentBackup(central, backup)
    validateCurrent(backup, 'central')
    writeFileSync(journal, JSON.stringify({ previous, next, backup, status: 'prepared' }), {
      flag: 'wx',
      mode: 0o600,
    })
    flush(journal)
    flush(root)
    const database = new DatabaseSync(central)
    try {
      remapLocalIssuer(database, previous, next)
    } finally {
      database.close()
    }
    validateCurrent(central, 'central')
    writeFileSync(journal, JSON.stringify({ previous, next, backup, status: 'committed' }))
    flush(journal)
    completed = true
  } finally {
    closeSync(descriptor)
    rmSync(lock)
    if (completed) {
      rmSync(gate)
      flush(root)
    }
  }
}

if (process.argv[1]?.endsWith('/network-identity.ts')) {
  const [central, previous, next, offline] = process.argv.slice(2)
  if (!central || !previous || !next) {
    throw new Error('Usage: network-identity.ts central previous-issuer https-issuer --offline')
  }
  await adoptNetworkIssuer(central, previous, next, offline === '--offline')
}
