import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'
import { prepareHistoricalDatabase } from './legacy-database-fixture.ts'
import { prepareLegacyCleanupMarker } from './legacy-study-schema.ts'
import { validateCurrent } from '../scripts/flyway-files.ts'

const owner = '11111111-1111-1111-1111-111111111111'

test('current deployed accounts, shared and personal schemas pass read-only adoption checks', () => {
  const root = mkdtempSync(join(tmpdir(), 'flyway-contract-'))
  try {
    const accounts = join(root, 'accounts.sqlite3')
    const shared = join(root, 'shared.sqlite3')
    prepareHistoricalDatabase(accounts, 'accounts')
    prepareHistoricalDatabase(shared, 'shared')
    prepareHistoricalDatabase(join(root, 'personal', `${owner}.sqlite3`), 'personal', owner)
    for (const [path, kind, id] of [
      [accounts, 'accounts', undefined],
      [shared, 'shared', undefined],
      [join(root, 'personal', `${owner}.sqlite3`), 'personal', owner],
    ] as const) {
      const before = readFileSync(path)
      validateCurrent(path, kind, id)
      assert.deepEqual(readFileSync(path), before)
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('foreign, future, altered trigger and wrong owner are refused without writes', () => {
  const root = mkdtempSync(join(tmpdir(), 'flyway-refusal-'))
  try {
    const path = join(root, 'shared.sqlite3')
    prepareHistoricalDatabase(path, 'shared')
    const db = new DatabaseSync(path)
    db.exec('PRAGMA user_version = 99')
    db.close()
    const before = readFileSync(path)
    assert.throws(() => validateCurrent(path, 'shared'), /identity|version/i)
    assert.deepEqual(readFileSync(path), before)
    const alter = new DatabaseSync(path)
    alter.exec('PRAGMA user_version = 4; DROP TRIGGER quiz_evidence_update')
    alter.close()
    assert.throws(() => validateCurrent(path, 'shared'), /schema/i)
    const personalDirectory = join(root, 'personal')
    prepareHistoricalDatabase(join(personalDirectory, `${owner}.sqlite3`), 'personal', owner)
    const personal = join(personalDirectory, `${owner}.sqlite3`)
    const personalBefore = readFileSync(personal)
    assert.throws(
      () => validateCurrent(personal, 'personal', '22222222-2222-2222-2222-222222222222'),
      /owner/i,
    )
    assert.deepEqual(readFileSync(personal), personalBefore)
    assert.throws(() => validateCurrent(path, 'accounts'), /identity|version/i)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('WAL backup includes committed pages and never overwrites an existing backup', async () => {
  const { consistentBackup } = await import('../scripts/flyway-files.ts')
  const root = mkdtempSync(join(tmpdir(), 'flyway-backup-'))
  const source = join(root, 'wal.sqlite3')
  const destination = join(root, 'backup.sqlite3')
  const db = new DatabaseSync(source)
  try {
    db.exec(
      "PRAGMA journal_mode = WAL; CREATE TABLE records (value TEXT); INSERT INTO records VALUES ('committed WAL')",
    )
    await consistentBackup(source, destination)
    const saved = new DatabaseSync(destination, { readOnly: true })
    try {
      assert.equal(saved.prepare('SELECT value FROM records').get()?.value, 'committed WAL')
    } finally {
      saved.close()
    }
    const before = readFileSync(destination)
    await assert.rejects(consistentBackup(source, destination), /EEXIST/)
    assert.deepEqual(readFileSync(destination), before)
  } finally {
    db.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('adoption validates indices, independent markers, constraints and optional cleanup', () => {
  const root = mkdtempSync(join(tmpdir(), 'flyway-exact-'))
  try {
    for (const sql of [
      'DROP INDEX questions_fingerprint',
      'DELETE FROM concept_schema',
      'CREATE INDEX unexpected ON questions(reference)',
      'CREATE TABLE unexpected (value TEXT)',
      'PRAGMA application_id = 1',
    ]) {
      const path = join(root, `${Math.random()}.sqlite3`)
      prepareHistoricalDatabase(path, 'shared')
      const db = new DatabaseSync(path)
      db.exec(sql)
      db.close()
      const before = readFileSync(path)
      assert.throws(() => validateCurrent(path, 'shared'))
      assert.deepEqual(readFileSync(path), before)
    }
    const path = join(root, 'cleanup.sqlite3')
    prepareHistoricalDatabase(path, 'shared')
    prepareLegacyCleanupMarker(path)
    validateCurrent(path, 'shared')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

/** A synthetic audit row isolates filesystem tests; Docker tests generate the real template. */
async function syntheticTemplate(root: string): Promise<string> {
  const { sealTemplate } = await import('../scripts/flyway-files.ts')
  const path = join(root, 'template.sqlite3')
  const db = new DatabaseSync(path)
  try {
    db.exec(
      readFileSync(
        new URL('../dev/flyway/personal/V1__current_schema.sql', import.meta.url),
        'utf8',
      ),
    )
    db.exec(`CREATE TABLE flyway_schema_history (
      installed_rank INTEGER, version TEXT, description TEXT, type TEXT, script TEXT,
      checksum INTEGER, success INTEGER
    );
    INSERT INTO flyway_schema_history VALUES (1, '1', 'current schema', 'SQL', 'V1__current_schema.sql', 1, 1);`)
  } finally {
    db.close()
  }
  sealTemplate(path)
  return path
}

test('template provisioning refuses corruption, stale metadata, links and wrong existing owner', async () => {
  const { provisionTemplate, verifyTemplate } = await import('../scripts/flyway-files.ts')
  const { symlinkSync, writeFileSync, statSync } = await import('node:fs')
  const root = mkdtempSync(join(tmpdir(), 'flyway-provision-'))
  try {
    const template = await syntheticTemplate(root)
    const directory = join(root, 'personal')
    const path = provisionTemplate(template, directory, owner)
    validateCurrent(path, 'personal', owner)
    assert.equal(statSync(directory).mode & 0o777, 0o700)
    assert.equal(statSync(path).mode & 0o777, 0o600)
    const before = readFileSync(path)
    assert.equal(provisionTemplate(template, directory, owner), path)
    assert.deepEqual(readFileSync(path), before)
    const db = new DatabaseSync(path)
    db.prepare('UPDATE private_library_owner SET account_id = ?').run(
      '22222222-2222-2222-2222-222222222222',
    )
    db.close()
    const wrongOwnerBefore = readFileSync(path)
    assert.throws(() => provisionTemplate(template, directory, owner), /owner/i)
    assert.deepEqual(readFileSync(path), wrongOwnerBefore)
    const link = join(root, 'linked')
    symlinkSync(directory, link)
    assert.throws(() => provisionTemplate(template, link, owner), /links/i)
    assert.throws(() => provisionTemplate(template, directory, '../unsafe'), /canonical/i)
    const original = readFileSync(template)
    writeFileSync(template, Buffer.concat([original, Buffer.from('corrupt')]))
    assert.throws(() => verifyTemplate(template), /corrupt|stale/i)
    writeFileSync(template, original)
    const manifest = JSON.parse(readFileSync(`${template}.manifest.json`, 'utf8'))
    manifest.migrationSha256 = 'stale'
    writeFileSync(`${template}.manifest.json`, JSON.stringify(manifest))
    assert.throws(() => verifyTemplate(template), /corrupt|stale/i)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('template sealing refuses any baked-in owner or content', async () => {
  const { sealTemplate } = await import('../scripts/flyway-files.ts')
  const root = mkdtempSync(join(tmpdir(), 'flyway-empty-'))
  try {
    const path = await syntheticTemplate(root)
    rmSync(`${path}.manifest.json`)
    const db = new DatabaseSync(path)
    db.exec("INSERT INTO quiz_sessions VALUES ('someone', 'attempt', 'complete', 1, '{}')")
    db.close()
    assert.throws(() => sealTemplate(path), /content|history|owner/i)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('offline maintenance refuses missing acknowledgement, concurrent runs and wrong owners before history writes', async () => {
  const { createWorkspace, maintainFleet } = await import('../scripts/flyway-prototype.ts')
  const { mkdirSync, writeFileSync, existsSync } = await import('node:fs')
  const root = createWorkspace()
  try {
    await assert.rejects(maintainFleet(root, false), /offline/i)
    assert.equal(existsSync(join(root, 'RESTART_BLOCKED')), false)
    writeFileSync(join(root, 'maintenance.lock'), 'another operator', { mode: 0o600 })
    await assert.rejects(maintainFleet(root, true), /EEXIST/)
    rmSync(join(root, 'maintenance.lock'))
    const accounts = join(root, 'accounts.sqlite3')
    const shared = join(root, 'shared.sqlite3')
    prepareHistoricalDatabase(accounts, 'accounts')
    prepareHistoricalDatabase(shared, 'shared')
    const fleet = join(root, 'fleet')
    mkdirSync(fleet, { mode: 0o700 })
    prepareHistoricalDatabase(join(fleet, `${owner}.sqlite3`), 'personal', owner)
    const personal = join(fleet, `${owner}.sqlite3`)
    const db = new DatabaseSync(personal)
    db.prepare('UPDATE private_library_owner SET account_id = ?').run(
      '22222222-2222-2222-2222-222222222222',
    )
    db.close()
    const before = [accounts, shared, personal].map((path) => readFileSync(path))
    await assert.rejects(maintainFleet(root, true), /owner/i)
    assert.equal(existsSync(join(root, 'RESTART_BLOCKED')), true)
    assert.equal(existsSync(join(root, 'maintenance.lock')), false)
    for (const [index, path] of [accounts, shared, personal].entries()) {
      assert.deepEqual(readFileSync(path), before[index])
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('same-directory prepared install never replaces a wrong-owner winner', async () => {
  const { installPrepared } = await import('../scripts/flyway-files.ts')
  const { copyFileSync, chmodSync } = await import('node:fs')
  const root = mkdtempSync(join(tmpdir(), 'flyway-atomic-'))
  try {
    const template = await syntheticTemplate(root)
    const prepared = join(root, '.initializing.sqlite3')
    copyFileSync(template, prepared)
    const db = new DatabaseSync(prepared)
    db.prepare('INSERT INTO private_library_owner VALUES (1, ?)').run(owner)
    db.close()
    chmodSync(prepared, 0o600)
    const target = join(root, `${owner}.sqlite3`)
    copyFileSync(prepared, target)
    const wrong = new DatabaseSync(target)
    wrong
      .prepare('UPDATE private_library_owner SET account_id = ?')
      .run('22222222-2222-2222-2222-222222222222')
    wrong.close()
    const before = readFileSync(target)
    assert.throws(() => installPrepared(prepared, root, owner), /owner/i)
    assert.deepEqual(readFileSync(target), before)
    rmSync(target)
    assert.equal(installPrepared(prepared, root, owner), target)
    validateCurrent(target, 'personal', owner)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('the standalone driver refuses foreign baseline before launching Flyway', async () => {
  const { createWorkspace, flyway } = await import('../scripts/flyway-prototype.ts')
  const root = createWorkspace()
  try {
    const path = join(root, 'foreign.sqlite3')
    const db = new DatabaseSync(path)
    db.exec('CREATE TABLE unrelated (id INTEGER)')
    db.close()
    const before = readFileSync(path)
    await assert.rejects(flyway(root, path, 'accounts', ['baseline']), /identity|version/i)
    assert.deepEqual(readFileSync(path), before)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('legacy format numbers and occupied version-zero files cannot be adopted as current', () => {
  const root = mkdtempSync(join(tmpdir(), 'flyway-legacy-gate-'))
  try {
    for (const version of [1, 2, 3]) {
      const path = join(root, `library-v${version}.sqlite3`)
      const db = new DatabaseSync(path)
      db.exec(`CREATE TABLE preserved_legacy_data (value TEXT);
        INSERT INTO preserved_legacy_data VALUES ('must remain untouched');
        PRAGMA application_id = 1096242004; PRAGMA user_version = ${version};`)
      db.close()
      const before = readFileSync(path)
      assert.throws(() => validateCurrent(path, 'shared'), /legacy|version/i)
      assert.deepEqual(readFileSync(path), before)
    }
    const accountV1 = join(root, 'accounts-v1.sqlite3')
    const db = new DatabaseSync(accountV1)
    db.exec(`CREATE TABLE accounts (
      id TEXT PRIMARY KEY, issuer TEXT NOT NULL, subject TEXT NOT NULL,
      name TEXT NOT NULL, UNIQUE(issuer, subject)
    );
    CREATE TABLE sessions (
      token_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id),
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX sessions_expiry ON sessions(expires_at);
    INSERT INTO accounts VALUES ('legacy', 'https://issuer.invalid', 'subject', 'Synthetic legacy');
    PRAGMA application_id = 1096242005; PRAGMA user_version = 1;`)
    db.close()
    const before = readFileSync(accountV1)
    assert.throws(() => validateCurrent(accountV1, 'accounts'), /legacy|version/i)
    assert.deepEqual(readFileSync(accountV1), before)
    const occupied = join(root, 'unrecognized.sqlite3')
    const foreign = new DatabaseSync(occupied)
    foreign.exec('CREATE TABLE unrelated (id INTEGER)')
    foreign.close()
    const foreignBefore = readFileSync(occupied)
    assert.throws(() => validateCurrent(occupied, 'shared'), /identity|version/i)
    assert.deepEqual(readFileSync(occupied), foreignBefore)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
