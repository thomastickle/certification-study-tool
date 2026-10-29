import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'
import { validateCurrent } from '../scripts/database-files.ts'
import { convert, maintain, preflight, provision } from '../scripts/database-admin.ts'

/** Materialize exact deployed inputs, without relying on server initialization. */
function inputs(root: string) {
  const accounts = join(root, 'accounts.sqlite3')
  const shared = join(root, 'shared.sqlite3')
  const fleet = join(root, 'fleet')
  mkdirSync(fleet, { mode: 0o700 })
  const owner = randomUUID()
  for (const [path, kind] of [
    [accounts, 'accounts'],
    [shared, 'shared'],
  ]) {
    const db = new DatabaseSync(path!)
    db.exec(readFileSync(`dev/flyway/${kind}/V1__current_schema.sql`, 'utf8'))
    if (kind === 'accounts') {
      db.prepare('INSERT INTO accounts VALUES (?, ?, ?, ?)').run(
        owner,
        'issuer',
        'subject',
        'Owner',
      )
      db.prepare('INSERT INTO sessions VALUES (?, ?, ?, ?)').run(
        'synthetic-hash',
        owner,
        999,
        'student',
      )
    }
    db.close()
  }
  return { accounts, shared, fleet, destination: join(root, 'converted'), owner }
}

for (const [name, kind, sql] of [
  [
    'identity collision',
    'shared',
    "CREATE TABLE accounts (id TEXT PRIMARY KEY, issuer TEXT, subject TEXT, name TEXT); INSERT INTO accounts VALUES ('intruder', 'issuer', 'subject', 'Intruder')",
  ],
  ['unknown view', 'shared', 'CREATE VIEW unexpected AS SELECT * FROM sources'],
  ['unexpected shared audit history', 'shared', 'CREATE TABLE flyway_schema_history(version TEXT)'],
  [
    'weakened session constraint',
    'accounts',
    `
    ALTER TABLE sessions RENAME TO old_sessions;
    CREATE TABLE sessions (
      token_hash TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id),
      expires_at INTEGER NOT NULL,
      role TEXT NOT NULL DEFAULT 'student'
    );
    INSERT INTO sessions SELECT * FROM old_sessions;
    DROP TABLE old_sessions;
    CREATE INDEX sessions_expiry ON sessions(expires_at);
  `,
  ],
  ['unknown internal-looking name', 'shared', 'CREATE TABLE sqliteXpayload(value TEXT)'],
  [
    'unexpected trigger',
    'accounts',
    'CREATE TRIGGER unexpected AFTER INSERT ON accounts BEGIN DELETE FROM sessions; END',
  ],
  ['missing required index', 'accounts', 'DROP INDEX sessions_expiry'],
  ['missing required column', 'shared', 'ALTER TABLE sources DROP COLUMN certification_name'],
] as const) {
  test(`conversion refuses ${name} before creating output or changing inputs`, async (t) => {
    const root = mkdtempSync(join(tmpdir(), 'admin-schema-refusal-'))
    t.after(() => rmSync(root, { recursive: true, force: true }))
    const options = inputs(root)
    const db = new DatabaseSync(options[kind])
    db.exec(sql)
    db.close()
    const before = [readFileSync(options.accounts), readFileSync(options.shared)]
    assert.throws(() => preflight(options), /schema|contract|object|column/i)
    await assert.rejects(convert(options, true), /schema|contract|object|column/i)
    assert.equal(existsSync(options.destination), false)
    assert.deepEqual(readFileSync(options.accounts), before[0])
    assert.deepEqual(readFileSync(options.shared), before[1])
  })
}

test('provisioning, pending jobs and maintenance reject linked deployment markers', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'admin-marker-refusal-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const options = inputs(root)
  await convert(options, true)
  const central = join(options.destination, 'central.sqlite3')
  const template = join(options.destination, 'personal-template.sqlite3')
  const directory = join(options.destination, 'users')
  const path = join(directory, `${options.owner}.sqlite3`)
  rmSync(path)
  const before = readFileSync(central)
  const config = join(root, 'provision.json')
  writeFileSync(config, JSON.stringify({ central, template, directory, owner: options.owner }))
  for (const marker of ['dangling gate', 'linked gate', 'linked readiness', 'dangling readiness']) {
    const gate = join(options.destination, 'RESTART_BLOCKED')
    const ready = join(options.destination, 'READY')
    if (marker.endsWith('readiness')) {
      rmSync(ready)
      const target = join(root, marker)
      if (marker === 'linked readiness') {
        writeFileSync(target, '1\n')
      }
      symlinkSync(target, ready)
    } else {
      const target = join(root, 'gate-target')
      if (marker === 'linked gate') {
        writeFileSync(target, 'blocked')
      }
      symlinkSync(target, gate)
    }
    assert.throws(() => provision(central, template, directory, options.owner))
    await assert.rejects(maintain(options.destination, true))
    const result = spawnSync(
      process.execPath,
      ['scripts/database-admin.ts', 'provision-pending', config],
      {
        encoding: 'utf8',
        timeout: 10000,
      },
    )
    assert.equal(result.error, undefined)
    assert.notEqual(result.status, 0)
    assert.equal(existsSync(path), false)
    assert.deepEqual(readFileSync(central), before)
    if (marker.endsWith('readiness')) {
      rmSync(ready)
      writeFileSync(ready, '1\n')
    } else {
      rmSync(gate)
    }
  }
  const empty = new DatabaseSync(central)
  empty.exec('DELETE FROM sessions; DELETE FROM accounts')
  empty.close()
  symlinkSync(join(root, 'missing-gate'), join(options.destination, 'RESTART_BLOCKED'))
  const pending = spawnSync(
    process.execPath,
    ['scripts/database-admin.ts', 'provision-pending', config],
    {
      encoding: 'utf8',
      timeout: 10000,
    },
  )
  assert.equal(pending.error, undefined)
  assert.notEqual(pending.status, 0, 'An empty account list cannot bypass deployment gates')
  assert.equal(existsSync(path), false)
})

test('managed validation refuses an unexpected audit trigger instead of excluding metadata objects', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'admin-audit-refusal-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const path = join(root, 'central.sqlite3')
  const db = new DatabaseSync(path)
  db.exec(readFileSync('database/migrations/central/V1__current_schema.sql', 'utf8'))
  db.exec(readFileSync('database/legacy-contracts/flyway-history.sql', 'utf8'))
  db.exec(
    "INSERT INTO flyway_schema_history(installed_rank, version, description, type, script, checksum, installed_by, execution_time, success) VALUES (1, '1', 'current schema', 'SQL', 'V1__current_schema.sql', 0, 'synthetic', 0, 1)",
  )
  db.close()
  assert.doesNotThrow(() => validateCurrent(path, 'central'))
  const alter = new DatabaseSync(path)
  alter.exec(
    'CREATE TRIGGER unexpected_audit AFTER INSERT ON flyway_schema_history BEGIN DELETE FROM accounts; END',
  )
  alter.close()
  const before = readFileSync(path)
  assert.throws(() => validateCurrent(path, 'central'), /schema|contract/)
  assert.deepEqual(readFileSync(path), before)
})

test('a deployed v1 account database upgraded by ALTER remains a supported v2 contract', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'admin-upgraded-auth-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const options = inputs(root)
  rmSync(options.accounts)
  const db = new DatabaseSync(options.accounts)
  db.exec(readFileSync('database/legacy-contracts/accounts-v1.sql', 'utf8'))
  db.prepare('INSERT INTO accounts VALUES (?, ?, ?, ?)').run(
    options.owner,
    'issuer',
    'subject',
    'Owner',
  )
  db.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run('synthetic-hash', options.owner, 999)
  db.exec(
    "ALTER TABLE sessions ADD COLUMN role TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('admin', 'student')); PRAGMA application_id = 1096242005; PRAGMA user_version = 2",
  )
  db.close()
  const before = readFileSync(options.accounts)
  assert.deepEqual(preflight(options).accounts, [options.owner])
  assert.deepEqual(readFileSync(options.accounts), before)
})
