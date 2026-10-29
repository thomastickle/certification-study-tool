import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { createRequire, syncBuiltinESMExports } from 'node:module'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'
import {
  convert,
  generateTemplate,
  initialize,
  preflight,
  provision,
} from '../scripts/database-admin.ts'
import { provisionTemplate, validateCurrent, verifyTemplate } from '../scripts/database-files.ts'
import { AccountRepository } from '../src/server/auth/account-repository.ts'
import { PrivateLibraries } from '../src/server/questions/private-libraries.ts'
import { waitForApplication } from './support/application-readiness.ts'

/** Recreate supported deployed files without inventing a personal directory. */
function legacyInputs(root: string, version: number) {
  const accounts = join(root, 'accounts.sqlite3')
  const shared = join(root, 'shared.sqlite3')
  const owner = randomUUID()
  const auth = new DatabaseSync(accounts)
  auth.exec(readFileSync('database/legacy-contracts/accounts-v1.sql', 'utf8'))
  auth.exec('PRAGMA application_id = 1096242005; PRAGMA user_version = 1')
  auth.prepare('INSERT INTO accounts VALUES (?, ?, ?, ?)').run(owner, 'issuer', 'subject', 'Owner')
  auth.close()
  const library = new DatabaseSync(shared)
  library.exec(readFileSync(`database/legacy-contracts/shared-v${version}.sql`, 'utf8'))
  library.exec(`PRAGMA application_id = 1096242004; PRAGMA user_version = ${version}`)
  library.exec('INSERT INTO library_state VALUES (1, 0)')
  if (version >= 2) {
    library.exec(
      'INSERT INTO concept_schema VALUES (1); INSERT INTO certification_schema VALUES (1)',
    )
  }
  if (version === 2) {
    library.exec("INSERT INTO quiz_mastery VALUES ('saved', 1, 3)")
  }
  library.close()
  return { accounts, shared, owner, fleet: join(root, 'users'), destination: join(root, 'output') }
}

for (const version of [1, 2]) {
  test(`pre-private v${version} conversion accepts an absent fleet and preserves originals`, async (t) => {
    const root = mkdtempSync(join(tmpdir(), 'admin-no-fleet-'))
    t.after(() => rmSync(root, { recursive: true, force: true }))
    const options = legacyInputs(root, version)
    const before = [readFileSync(options.accounts), readFileSync(options.shared)]
    const config = { ...options, legacyOwner: options.owner }
    assert.deepEqual(preflight(config).privateFiles, [])
    await convert(config, true)
    assert.equal(readFileSync(join(options.destination, 'READY'), 'utf8'), '1\n')
    const personal = join(options.destination, 'users', `${options.owner}.sqlite3`)
    validateCurrent(personal, 'personal', options.owner)
    if (version === 2) {
      const db = new DatabaseSync(personal, { readOnly: true })
      assert.equal(db.prepare('SELECT correct_streak FROM quiz_mastery').get()?.correct_streak, 3)
      db.close()
    }
    assert.equal(existsSync(options.fleet), false)
    assert.deepEqual(readFileSync(options.accounts), before[0])
    assert.deepEqual(readFileSync(options.shared), before[1])
  })
}

test('missing modern fleets and linked pre-private fleets still fail closed', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'admin-unsafe-fleet-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const options = legacyInputs(root, 3)
  assert.throws(() => preflight(options), /fleet/i)
  const older = new DatabaseSync(options.shared)
  older.exec('PRAGMA user_version = 2')
  older.close()
  symlinkSync(join(root, 'missing'), options.fleet)
  assert.throws(() => preflight(options), /links/i)
  assert.equal(existsSync(options.destination), false)
})

for (const version of [3, 4]) {
  for (const damage of ['unknown owner', 'orphan']) {
    test(`v${version} shared ${damage} evidence is refused before cleanup or output creation`, async (t) => {
      const root = mkdtempSync(join(tmpdir(), 'admin-evidence-refusal-'))
      t.after(() => rmSync(root, { recursive: true, force: true }))
      const options = legacyInputs(root, version)
      mkdirSync(options.fleet, { mode: 0o700 })
      rmSync(options.shared)
      const db = new DatabaseSync(options.shared)
      db.exec(readFileSync('dev/flyway/shared/V1__current_schema.sql', 'utf8'))
      db.exec(`PRAGMA user_version = ${version}`)
      if (version === 3) {
        db.exec('DROP TABLE deleted_sources; DROP TABLE shared_deletion_cursor')
      }
      const evidenceOwner = damage === 'unknown owner' ? randomUUID() : options.owner
      db.prepare('INSERT INTO quiz_evidence VALUES (?, ?, 1, NULL, NULL, ?, ?)').run(
        evidenceOwner,
        'lost-attempt',
        '{}',
        'synthetic',
      )
      db.close()
      const before = readFileSync(options.shared)
      assert.throws(() => preflight(options), /evidence|owner/i)
      await assert.rejects(convert(options, true), /evidence|owner/i)
      assert.equal(existsSync(options.destination), false)
      assert.deepEqual(readFileSync(options.shared), before)
    })
  }
}

test(
  'standalone init publishes a usable empty deployment and refuses reuse',
  { timeout: 60000 },
  async (t) => {
    const root = mkdtempSync(join(tmpdir(), 'admin-fresh-install-'))
    t.after(() => rmSync(root, { recursive: true, force: true }))
    const destination = join(root, 'deployment')
    const result = spawnSync(process.execPath, ['scripts/database-admin.ts', 'init', destination], {
      encoding: 'utf8',
      timeout: 60000,
    })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(readFileSync(join(destination, 'READY'), 'utf8'), '1\n')
    assert.equal(existsSync(join(destination, 'RESTART_BLOCKED')), false)
    validateCurrent(join(destination, 'central.sqlite3'), 'central')
    verifyTemplate(join(destination, 'personal-template.sqlite3'))
    assert.equal(statSync(join(destination, 'users')).mode & 0o777, 0o700)
    const central = new DatabaseSync(join(destination, 'central.sqlite3'), { readOnly: true })
    assert.equal(central.prepare('SELECT count(*) AS n FROM accounts').get()?.n, 0)
    central.close()
    const accounts = new AccountRepository(join(destination, 'central.sqlite3'))
    const account = accounts.identify({ issuer: 'synthetic', subject: 'first-user', name: 'First' })
    accounts.close()
    provision(
      join(destination, 'central.sqlite3'),
      join(destination, 'personal-template.sqlite3'),
      join(destination, 'users'),
      account.id,
    )
    const library = new PrivateLibraries(join(destination, 'users')).open(account.id)
    assert.deepEqual(library.forAccount(account.id).quizStore().snapshots(), [])
    library.close()
    mkdirSync(join(root, 'dist'))
    writeFileSync(join(root, 'dist/index.html'), '<title>Fresh installation</title>')
    const probe = createServer()
    await new Promise<void>((done) => probe.listen(0, '127.0.0.1', done))
    const address = probe.address()
    assert.ok(address && typeof address !== 'string')
    await new Promise<void>((done) => probe.close(() => done()))
    const origin = new URL(`http://127.0.0.1:${address.port}`)
    const child = spawn(process.execPath, [resolve('build/src/server/main.js')], {
      cwd: root,
      env: {
        NODE_ENV: 'production',
        STUDY_DB_PATH: join(destination, 'central.sqlite3'),
        STUDY_PRIVATE_LIBRARIES_DIR: join(destination, 'users'),
        STUDY_HOST: '127.0.0.1',
        STUDY_PORT: String(address.port),
        STUDY_ORIGIN: origin.origin,
        STUDY_OIDC_ISSUER: 'http://127.0.0.1:9/realms/synthetic',
      },
      stdio: 'ignore',
    })
    const exit = once(child, 'exit')
    try {
      await waitForApplication(origin, 10000)
      assert.equal(await (await fetch(origin)).text(), '<title>Fresh installation</title>')
      assert.equal((await fetch(new URL('/api/questions', origin))).status, 401)
    } finally {
      child.kill('SIGTERM')
      const [code, signal] = await exit
      assert.equal(code, 0)
      assert.equal(signal, null)
    }
    const before = readFileSync(join(destination, 'central.sqlite3'))
    const retry = spawnSync(process.execPath, ['scripts/database-admin.ts', 'init', destination], {
      encoding: 'utf8',
      timeout: 10000,
    })
    assert.notEqual(retry.status, 0)
    assert.deepEqual(readFileSync(join(destination, 'central.sqlite3')), before)
  },
)

test('failed initialization stays blocked and never publishes READY', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'admin-init-failure-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const destination = join(root, 'deployment')
  const childProcess = createRequire(import.meta.url)(
    'node:child_process',
  ) as typeof import('node:child_process')
  const original = childProcess.spawnSync
  let calls = 0
  const failure = t.mock.method(
    childProcess,
    'spawnSync',
    (...args: Parameters<typeof original>) => {
      assert.equal(existsSync(join(destination, 'READY')), false)
      assert.equal(existsSync(join(destination, 'RESTART_BLOCKED')), true)
      if (++calls === 2) {
        throw new Error('Injected template preparation failure')
      }
      return original(...args)
    },
  )
  syncBuiltinESMExports()
  try {
    assert.throws(() => initialize(destination), /Injected template/)
    assert.equal(calls, 2)
    validateCurrent(join(destination, 'central.sqlite3'), 'central')
    assert.equal(existsSync(join(destination, 'READY')), false)
    assert.equal(existsSync(join(destination, 'RESTART_BLOCKED')), true)
    assert.equal(existsSync(join(destination, 'maintenance.lock')), false)
    assert.throws(() => initialize(destination), /EEXIST/)
  } finally {
    failure.mock.restore()
    syncBuiltinESMExports()
  }
})

test('concurrent provisioning winners receive the same trusted-history checks as existing files', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'admin-provision-race-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const template = generateTemplate(root)
  const directory = join(root, 'users')
  const fs = createRequire(import.meta.url)('node:fs') as typeof import('node:fs')
  const original = fs.linkSync
  for (const mismatch of [false, true]) {
    const owner = randomUUID()
    const target = join(directory, `${owner}.sqlite3`)
    const replacement = t.mock.method(
      fs,
      'linkSync',
      (temporary: import('node:fs').PathLike, destination: import('node:fs').PathLike) => {
        fs.copyFileSync(temporary, destination)
        if (mismatch) {
          const winner = new DatabaseSync(String(destination))
          winner.exec('UPDATE flyway_schema_history SET checksum = checksum + 1')
          winner.close()
        }
        original(temporary, destination)
      },
    )
    syncBuiltinESMExports()
    try {
      if (mismatch) {
        assert.throws(() => provisionTemplate(template, directory, owner), /trusted template/)
      } else {
        assert.equal(provisionTemplate(template, directory, owner), target)
      }
      assert.equal(replacement.mock.callCount(), 1)
      validateCurrent(target, 'personal', owner)
      const before = readFileSync(target)
      if (mismatch) {
        assert.throws(() => provisionTemplate(template, directory, owner), /trusted template/)
      }
      assert.deepEqual(readFileSync(target), before)
      assert.deepEqual(
        fs.readdirSync(directory).filter((name) => name.startsWith('.')),
        [],
      )
    } finally {
      replacement.mock.restore()
      syncBuiltinESMExports()
    }
  }
})
