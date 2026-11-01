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
import {
  consistentBackup,
  rejectLinks,
  requireFile,
  validateCurrent,
  sha256,
} from './database-files.ts'

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

export type ActivationPlan = { environmentHash: string; overlayHash: string }

/**
 * Prepare the identity transition while retaining its restart gate until configuration activation.
 * @throws {Error} For unsafe/unready storage or a failed cutover; failures retain the restart gate.
 */
export async function adoptNetworkIssuer(
  central: string,
  previous: string,
  next: string,
  offline: boolean,
  activation: ActivationPlan,
): Promise<string> {
  if (!offline) {
    throw new Error('Stop all application and CLI writers and acknowledge --offline.')
  }
  if (
    ![activation.environmentHash, activation.overlayHash].every((hash) =>
      /^[a-f0-9]{64}$/.test(hash),
    )
  ) {
    throw new Error('A complete hashed activation plan is required before changing identities.')
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
  const operation = randomUUID()
  try {
    writeFileSync(gate, JSON.stringify({ kind: 'network-identity', operation, next, activation }), {
      flag: 'wx',
      mode: 0o600,
    })
    flush(gate)
    flush(root)
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
    return operation
  } finally {
    closeSync(descriptor)
    rmSync(lock)
  }
}

/**
 * Release only this cutover's gate after the exact planned host configuration is durably installed.
 * @throws {Error} For a foreign gate, uncommitted identity change or mismatched/missing configuration; gate remains.
 */
export function completeNetworkIssuer(
  central: string,
  operation: string,
  environment: string,
  overlay: string,
  offline: boolean,
): void {
  if (!offline || !/^[a-f0-9-]{36}$/.test(operation)) {
    throw new Error('A prepared operation ID and --offline are required for activation.')
  }
  const root = dirname(central)
  const lock = join(root, 'maintenance.lock')
  const descriptor = openSync(lock, 'wx', 0o600)
  try {
    const gate = join(root, 'RESTART_BLOCKED')
    requireFile(gate)
    const ownership = JSON.parse(readFileSync(gate, 'utf8')) as {
      kind: string
      operation: string
      next: string
      activation: ActivationPlan
    }
    if (ownership.kind !== 'network-identity' || ownership.operation !== operation) {
      throw new Error('The restart gate belongs to another operation.')
    }
    for (const path of [environment, overlay]) {
      requireFile(path)
    }
    if (
      sha256(readFileSync(environment)) !== ownership.activation.environmentHash ||
      sha256(readFileSync(overlay)) !== ownership.activation.overlayHash
    ) {
      throw new Error('Host configuration does not match the prepared HTTPS activation plan.')
    }
    validateCurrent(central, 'central')
    const database = new DatabaseSync(central, { readOnly: true })
    try {
      if (
        database.prepare('SELECT 1 FROM accounts WHERE issuer != ? LIMIT 1').get(ownership.next)
      ) {
        throw new Error('The prepared identity transition is incomplete.')
      }
    } finally {
      database.close()
    }
    const journal = join(root, `identity-cutover-${operation}.json`)
    requireFile(journal)
    const record = JSON.parse(readFileSync(journal, 'utf8')) as { status: string; next: string }
    if (record.status !== 'committed' || record.next !== ownership.next) {
      throw new Error('The identity transaction has not committed.')
    }
    writeFileSync(journal, JSON.stringify({ ...record, status: 'activated' }))
    flush(journal)
    rmSync(gate)
    flush(root)
  } finally {
    closeSync(descriptor)
    rmSync(lock)
  }
}

if (process.argv[1]?.endsWith('/network-identity.ts')) {
  const [command, central, ...parameters] = process.argv.slice(2)
  if (!central) {
    throw new Error('An explicit prepared central database is required.')
  }
  if (command === 'prepare') {
    const [previousIssuer, nextIssuer, activationJson, offline] = parameters
    if (!previousIssuer || !nextIssuer || !activationJson) {
      throw new Error(
        'Usage: network-identity.ts prepare central old-issuer new-issuer activation-json --offline',
      )
    }
    const activation = JSON.parse(activationJson) as ActivationPlan
    const operation = await adoptNetworkIssuer(
      central,
      previousIssuer,
      nextIssuer,
      offline === '--offline',
      activation,
    )
    console.log(operation)
  } else if (command === 'complete') {
    const [operation, environment, overlay, offline] = parameters
    if (!operation || !environment || !overlay) {
      throw new Error(
        'Usage: network-identity.ts complete central operation environment overlay --offline',
      )
    }
    completeNetworkIssuer(central, operation, environment, overlay, offline === '--offline')
  } else {
    throw new Error('Unknown identity cutover command.')
  }
}
