import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'
import { preflight } from '../scripts/database-admin.ts'

test('preflight refuses a future format and symlinks before creating output', () => {
  const root = mkdtempSync(join(tmpdir(), 'database-admin-'))
  const accounts = join(root, 'accounts.sqlite3')
  const shared = join(root, 'shared.sqlite3')
  for (const [path, kind] of [
    [accounts, 'accounts'],
    [shared, 'shared'],
  ]) {
    const db = new DatabaseSync(path!)
    db.exec(readFileSync(`dev/flyway/${kind}/V1__current_schema.sql`, 'utf8'))
    db.close()
  }
  const fleet = join(root, 'fleet')
  mkdirSync(fleet, { mode: 0o700 })
  const options = { accounts, shared, fleet, destination: join(root, 'output') }
  assert.equal(preflight(options).accounts.length, 0)
  const db = new DatabaseSync(shared)
  db.exec('PRAGMA user_version = 2')
  assert.throws(() => preflight(options), /ownership schema/)
  db.exec('PRAGMA user_version = 99')
  db.close()
  assert.throws(() => preflight(options), /format/)
  symlinkSync(accounts, join(root, 'linked'))
  assert.throws(() => preflight({ ...options, accounts: join(root, 'linked') }), /links/)
})

import { convert } from '../scripts/database-admin.ts'
import { chmodSync, existsSync, statSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

// Real pinned Flyway, never a substituted history table.
test('real conversion preserves identities, roles, sessions and owner evidence; originals remain intact', async () => {
  const root = mkdtempSync(join(tmpdir(), 'database-conversion-'))
  const accounts = join(root, 'accounts.sqlite3')
  const shared = join(root, 'shared.sqlite3')
  const fleet = join(root, 'fleet')
  mkdirSync(fleet, { mode: 0o700 })
  const owners = [randomUUID(), randomUUID()]
  const auth = new DatabaseSync(accounts)
  auth.exec(readFileSync('dev/flyway/accounts/V1__current_schema.sql', 'utf8'))
  for (const owner of owners) {
    auth.prepare('INSERT INTO accounts VALUES (?, ?, ?, ?)').run(owner, 'issuer', owner, 'name')
    auth
      .prepare('INSERT INTO sessions VALUES (?, ?, ?, ?)')
      .run(`hash-${owner}`, owner, 999, 'admin')
  }
  auth.close()
  const library = new DatabaseSync(shared)
  library.exec(readFileSync('dev/flyway/shared/V1__current_schema.sql', 'utf8'))
  for (const owner of owners) {
    library.prepare('INSERT INTO quiz_mastery VALUES (?, ?, ?, ?)').run(owner, 'fingerprint', 1, 4)
  }
  library.close()
  const before = [readFileSync(accounts), readFileSync(shared)]
  const destination = join(root, 'output')
  const options = { accounts, shared, fleet, destination }
  await assert.rejects(convert(options, false), /Stop\/drain/)
  await convert(options, true)
  assert.equal(existsSync(join(destination, 'RESTART_BLOCKED')), false)
  assert.equal(readFileSync(join(destination, 'READY'), 'utf8'), '1\n')
  const central = new DatabaseSync(join(destination, 'central.sqlite3'), { readOnly: true })
  assert.equal(
    central.prepare('SELECT count(*) AS n FROM sessions WHERE role = ?').get('admin')?.n,
    2,
  )
  assert.equal(central.prepare('SELECT count(*) AS n FROM quiz_mastery').get()?.n, 0)
  central.close()
  for (const owner of owners) {
    const path = join(destination, 'users', `${owner}.sqlite3`)
    const db = new DatabaseSync(path, { readOnly: true })
    assert.equal(
      db.prepare('SELECT correct_streak FROM quiz_mastery WHERE account_id = ?').get(owner)
        ?.correct_streak,
      4,
    )
    db.close()
    assert.equal(statSync(path).mode & 0o777, 0o600)
  }
  assert.deepEqual(readFileSync(accounts), before[0])
  assert.deepEqual(readFileSync(shared), before[1])
  await assert.rejects(convert(options, true), /already exists/)
  chmodSync(destination, 0o700)
  const personal = join(destination, 'users', `${owners[0]}.sqlite3`)
  assert.throws(() => validateCurrent(personal, 'personal', owners[1]), /owner mismatch/)
  const future = new DatabaseSync(personal)
  future.exec('PRAGMA user_version = 99')
  future.close()
  assert.throws(() => validateCurrent(personal, 'personal', owners[0]), /identity\/version/)
  const manifest = join(destination, 'personal-template.sqlite3.manifest.json')
  const stale = JSON.parse(readFileSync(manifest, 'utf8'))
  stale.migrationSha256 = 'stale'
  writeFileSync(manifest, JSON.stringify(stale))
  assert.throws(
    () => verifyTemplate(join(destination, 'personal-template.sqlite3')),
    /Corrupt or stale/,
  )
})

import { consistentBackup, validateCurrent, verifyTemplate } from '../scripts/database-files.ts'

test('consistent backup includes committed WAL rows and refuses overwrite', async () => {
  const root = mkdtempSync(join(tmpdir(), 'database-backup-'))
  const source = join(root, 'source.sqlite3')
  const destination = join(root, 'backup.sqlite3')
  const db = new DatabaseSync(source)
  try {
    db.exec(
      'PRAGMA journal_mode = WAL; CREATE TABLE records(id INTEGER); INSERT INTO records VALUES (37)',
    )
    await consistentBackup(source, destination)
    const saved = new DatabaseSync(destination, { readOnly: true })
    assert.equal(saved.prepare('SELECT id FROM records').get()?.id, 37)
    saved.close()
    await assert.rejects(consistentBackup(source, destination), /EEXIST/)
    assert.equal(statSync(destination).mode & 0o777, 0o600)
  } finally {
    db.close()
  }
})

import { legacyAccountSchema, legacyStudySchema } from './legacy-study-schema.ts'
import { provision, maintain } from '../scripts/database-admin.ts'

test('deployed preowner fixture requires verified owner, defaults v1 sessions to student and gates conflict failure', async () => {
  const root = mkdtempSync(join(tmpdir(), 'database-legacy-conversion-'))
  const accounts = join(root, 'accounts.sqlite3')
  const shared = join(root, 'shared.sqlite3')
  const fleet = join(root, 'fleet')
  mkdirSync(fleet, { mode: 0o700 })
  const owner = randomUUID()
  const auth = new DatabaseSync(accounts)
  auth.exec(legacyAccountSchema)
  auth.prepare('INSERT INTO accounts VALUES (?, ?, ?, ?)').run(owner, 'issuer', 'subject', 'name')
  auth.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run('legacy-hash', owner, 123)
  auth.close()
  const library = new DatabaseSync(shared)
  library.exec(readFileSync('dev/flyway/shared/V1__current_schema.sql', 'utf8'))
  library.exec(legacyStudySchema)
  library.exec("INSERT INTO quiz_mastery VALUES ('legacy', 1, 5)")
  library.close()
  const destination = join(root, 'converted')
  const options = { accounts, shared, fleet, destination }
  assert.throws(() => preflight(options), /verified account/)
  await convert({ ...options, legacyOwner: owner }, true)
  const db = new DatabaseSync(join(destination, 'central.sqlite3'), { readOnly: true })
  assert.equal(db.prepare('SELECT token_hash, role FROM sessions').get()?.token_hash, 'legacy-hash')
  assert.equal(db.prepare('SELECT role FROM sessions').get()?.role, 'student')
  db.close()
  const template = join(destination, 'personal-template.sqlite3')
  const central = join(destination, 'central.sqlite3')
  assert.throws(
    () => provision(central, template, join(root, 'new'), randomUUID()),
    /Unknown account/,
  )
  assert.equal(
    provision(central, template, join(destination, 'users'), owner),
    join(destination, 'users', `${owner}.sqlite3`),
  )
  chmodSync(join(destination, 'users', `${owner}.sqlite3`), 0o644)
  assert.throws(() => provision(central, template, join(destination, 'users'), owner), /0600/)
  chmodSync(join(destination, 'users', `${owner}.sqlite3`), 0o600)
  await assert.rejects(maintain(destination, false), /Stop\/drain/)
  const conflict = {
    ...options,
    fleet: join(destination, 'users'),
    destination: join(root, 'conflict'),
    legacyOwner: owner,
  }
  await assert.rejects(convert(conflict, true), /already contains study evidence/)
  assert.equal(existsSync(join(conflict.destination, 'RESTART_BLOCKED')), true)
  assert.equal(existsSync(join(conflict.destination, 'READY')), false)
  assert.equal(existsSync(join(conflict.destination, 'backups', '0.sqlite3')), true)
  await maintain(destination, true)
  assert.equal(existsSync(join(destination, 'RESTART_BLOCKED')), false)
  const tampered = new DatabaseSync(central)
  tampered.exec('UPDATE flyway_schema_history SET checksum = checksum + 1')
  tampered.close()
  await assert.rejects(maintain(destination, true), /Flyway failed/)
  assert.equal(existsSync(join(destination, 'RESTART_BLOCKED')), true)
  await assert.rejects(maintain(destination, true), /Prior failure/)
})

for (const version of [1, 3]) {
  test(`real conversion accepts deployed shared v${version} layout without inventing study owners`, async () => {
    const root = mkdtempSync(join(tmpdir(), `database-v${version}-`))
    const accounts = join(root, 'accounts.sqlite3')
    const shared = join(root, 'shared.sqlite3')
    const fleet = join(root, 'fleet')
    mkdirSync(fleet, { mode: 0o700 })
    const auth = new DatabaseSync(accounts)
    auth.exec(legacyAccountSchema)
    auth.close()
    const db = new DatabaseSync(shared)
    db.exec(readFileSync('dev/flyway/shared/V1__current_schema.sql', 'utf8'))
    db.exec('DROP TABLE deleted_sources; DROP TABLE shared_deletion_cursor')
    if (version === 1) {
      db.exec(`
        DROP TRIGGER quiz_evidence_delete; DROP TRIGGER quiz_evidence_insert;
        DROP TRIGGER quiz_evidence_update; DROP TABLE quiz_evidence;
        DROP TABLE quiz_sessions; DROP TABLE quiz_mastery; DROP TABLE earned_certifications;
        DROP TABLE concept_schema; DROP TABLE reviewed_concepts;
        DROP TABLE dismissed_concept_suggestions; DROP TABLE certification_schema;
      `)
    }
    db.exec(`PRAGMA user_version = ${version}`)
    db.exec(
      "INSERT INTO sources VALUES (42, 'AWS', 'CLF-C02', 'Cloud', 'legacy', 'Legacy', 'curated', '{}')",
    )
    db.exec("INSERT INTO questions VALUES (57, 42, 'q', '{}', 'fp', '[]')")
    db.close()
    const destination = join(root, 'converted')
    await convert({ accounts, shared, fleet, destination }, true)
    const central = new DatabaseSync(join(destination, 'central.sqlite3'), { readOnly: true })
    assert.equal(
      central.prepare('SELECT source_id FROM questions WHERE id = 57').get()?.source_id,
      42,
    )
    assert.equal(central.prepare('SELECT count(*) AS n FROM quiz_sessions').get()?.n, 0)
    central.close()
  })
}
