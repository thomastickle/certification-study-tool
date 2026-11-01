import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'
import { sha256 } from '../scripts/database-files.ts'
import { initialize } from '../scripts/database-admin.ts'
import {
  remapLocalIssuer,
  adoptNetworkIssuer,
  completeNetworkIssuer,
} from '../scripts/network-identity.ts'
import { prepareManagedDatabase } from './managed-database-fixture.ts'

const previous = 'http://127.0.0.1:8080/realms/study'
const next = 'https://study-laptop.local:3443/realms/study'
const environmentContents = 'COMPOSE_FILE=compose.yaml:access.yaml\n'
const overlayContents = 'services: {}\n'
const activation = {
  environmentHash: sha256(Buffer.from(environmentContents)),
  overlayHash: sha256(Buffer.from(overlayContents)),
}

test('HTTPS identity cutover preserves account IDs and subjects, revokes sessions and is idempotent', () => {
  const database = prepareManagedDatabase()
  const owner = randomUUID()
  try {
    database
      .prepare('INSERT INTO accounts VALUES (?, ?, ?, ?)')
      .run(owner, previous, 'subject', 'Owner')
    database
      .prepare('INSERT INTO sessions VALUES (?, ?, ?, ?)')
      .run('synthetic', owner, 9999, 'admin')
    assert.equal(remapLocalIssuer(database, previous, next), 1)
    assert.deepEqual(
      { ...database.prepare('SELECT * FROM accounts').get() },
      {
        id: owner,
        issuer: next,
        subject: 'subject',
        name: 'Owner',
      },
    )
    assert.equal(database.prepare('SELECT count(*) AS n FROM sessions').get()?.n, 0)
    assert.equal(remapLocalIssuer(database, previous, next), 0)
  } finally {
    database.close()
  }
})

for (const problem of ['unknown issuer', 'colliding subject', 'failed update']) {
  test(`identity cutover refuses ${problem} without losing accounts or sessions`, () => {
    const database = prepareManagedDatabase()
    const owner = randomUUID()
    try {
      database
        .prepare('INSERT INTO accounts VALUES (?, ?, ?, ?)')
        .run(owner, previous, 'subject', 'Owner')
      database
        .prepare('INSERT INTO sessions VALUES (?, ?, ?, ?)')
        .run('synthetic', owner, 9999, 'admin')
      if (problem === 'unknown issuer') {
        database
          .prepare('INSERT INTO accounts VALUES (?, ?, ?, ?)')
          .run(randomUUID(), 'https://foreign.invalid/realm', 'other', 'Other')
      } else if (problem === 'colliding subject') {
        database
          .prepare('INSERT INTO accounts VALUES (?, ?, ?, ?)')
          .run(randomUUID(), next, 'subject', 'Other')
      } else {
        database.exec(
          "CREATE TRIGGER reject_identity BEFORE UPDATE ON accounts BEGIN SELECT RAISE(ABORT, 'owned failure'); END",
        )
      }
      const accounts = database.prepare('SELECT * FROM accounts').all()
      const sessions = database.prepare('SELECT * FROM sessions').all()
      assert.throws(() => remapLocalIssuer(database, previous, next))
      assert.deepEqual(database.prepare('SELECT * FROM accounts').all(), accounts)
      assert.deepEqual(database.prepare('SELECT * FROM sessions').all(), sessions)
      assert.equal(database.isTransaction, false)
    } finally {
      database.close()
    }
  })
}

test('offline HTTPS adoption verifies a backup and preserves restart gates after failure', async (testContext) => {
  const root = mkdtempSync(join(tmpdir(), 'study-network-adoption-'))
  testContext.after(() => rmSync(root, { recursive: true, force: true }))
  const deployment = join(root, 'managed')
  initialize(deployment)
  const central = join(deployment, 'central.sqlite3')
  const database = new DatabaseSync(central)
  const owner = randomUUID()
  database
    .prepare('INSERT INTO accounts VALUES (?, ?, ?, ?)')
    .run(owner, previous, 'subject', 'Owner')
  database.close()
  const before = readFileSync(central)
  await assert.rejects(adoptNetworkIssuer(central, previous, next, false, activation), /Stop all/)
  assert.deepEqual(readFileSync(central), before)
  const operation = await adoptNetworkIssuer(central, previous, next, true, activation)
  assert.equal(existsSync(join(deployment, 'RESTART_BLOCKED')), true)
  const environment = join(root, '.env')
  const overlay = join(root, 'access.yaml')
  writeFileSync(environment, environmentContents)
  writeFileSync(overlay, overlayContents)
  assert.throws(
    () => completeNetworkIssuer(central, randomUUID(), environment, overlay, true),
    /another operation/,
  )
  writeFileSync(overlay, 'not the planned HTTPS configuration')
  assert.throws(
    () => completeNetworkIssuer(central, operation, environment, overlay, true),
    /activation plan/,
  )
  assert.equal(existsSync(join(deployment, 'RESTART_BLOCKED')), true)
  writeFileSync(overlay, overlayContents)
  completeNetworkIssuer(central, operation, environment, overlay, true)
  assert.equal(existsSync(join(deployment, 'RESTART_BLOCKED')), false)
  const backupName = readdirSync(deployment).find((name) => name.startsWith('identity-backup-'))!
  const backup = new DatabaseSync(join(deployment, backupName), { readOnly: true })
  assert.equal(backup.prepare('SELECT issuer FROM accounts').get()?.issuer, previous)
  backup.close()
  const updated = new DatabaseSync(central, { readOnly: true })
  assert.equal(updated.prepare('SELECT id FROM accounts').get()?.id, owner)
  assert.equal(updated.prepare('SELECT issuer FROM accounts').get()?.issuer, next)
  updated.close()
  writeFileSync(join(deployment, 'RESTART_BLOCKED'), 'operator investigation\n')
  await assert.rejects(
    adoptNetworkIssuer(central, previous, next, true, activation),
    /existing restart gate/,
  )
  assert.equal(
    readFileSync(join(deployment, 'RESTART_BLOCKED'), 'utf8'),
    'operator investigation\n',
  )
})

test('a failed configuration activation cannot release the identity restart gate', async (testContext) => {
  const root = mkdtempSync(join(tmpdir(), 'study-network-activation-failure-'))
  testContext.after(() => rmSync(root, { recursive: true, force: true }))
  const deployment = join(root, 'managed')
  initialize(deployment)
  const central = join(deployment, 'central.sqlite3')
  const operation = await adoptNetworkIssuer(central, previous, next, true, activation)
  // Model the host configuration write failing after the database transaction has committed.
  assert.throws(() => readFileSync(join(root, 'configuration-not-written')))
  const overlay = join(root, 'access.yaml')
  writeFileSync(overlay, overlayContents)
  assert.throws(() =>
    completeNetworkIssuer(
      central,
      operation,
      join(root, 'configuration-not-written'),
      overlay,
      true,
    ),
  )
  const environment = join(root, '.env')
  writeFileSync(environment, 'COMPOSE_FILE=compose.yaml\n')
  assert.throws(
    () => completeNetworkIssuer(central, operation, environment, overlay, true),
    /activation plan/,
  )
  assert.equal(existsSync(join(deployment, 'RESTART_BLOCKED')), true)
})
