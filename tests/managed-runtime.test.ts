import assert from 'node:assert/strict'
import { mkdtempSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { AccountRepository } from '../src/server/auth/account-repository.ts'

test('missing central database fails without creating a file', () => {
  const directory = mkdtempSync(join(tmpdir(), 'managed-runtime-'))
  const path = join(directory, 'central.sqlite3')
  writeFileSync(join(directory, 'READY'), '1\n')
  try {
    assert.throws(() => new AccountRepository(path), /external|prepare/i)
    assert.equal(existsSync(path), false)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

import { prepareManagedDatabase } from './managed-database-fixture.ts'
import { LibraryRepository } from '../src/server/questions/library-repository.ts'
import { PrivateLibraries } from '../src/server/questions/private-libraries.ts'
import { validateManagedDatabase } from '../src/server/questions/managed-database.ts'

for (const [label, sql] of [
  ['foreign', 'PRAGMA application_id = 17'],
  ['old', 'PRAGMA user_version = 0'],
  ['future', 'PRAGMA user_version = 2'],
  ['unmanaged', 'DELETE FROM flyway_schema_history'],
  ['failed migration', 'UPDATE flyway_schema_history SET success = 0'],
  ['baseline without migration', "UPDATE flyway_schema_history SET type = 'BASELINE'"],
  ['unsupported script', "UPDATE flyway_schema_history SET script = 'unsupported.sql'"],
  ['incomplete', 'UPDATE private_study_separation SET complete = 0'],
  ['missing projection table', 'DROP TABLE quiz_evidence'],
] as const) {
  test(`reject ${label} central database without schema repair`, () => {
    const db = prepareManagedDatabase()
    try {
      db.exec(sql)
      assert.throws(() => validateManagedDatabase(db))
    } finally {
      db.close()
    }
  })
}

test('prepared central accepts normal verified identity and session writes', () => {
  const db = prepareManagedDatabase()
  const accounts = new AccountRepository(db)
  try {
    const account = accounts.identify({ issuer: 'synthetic', subject: 'one', name: 'One' })
    accounts.saveSession('synthetic-token', account.id, 100, 'student')
    assert.equal(accounts.session('synthetic-token', 1, 'synthetic')?.id, account.id)
  } finally {
    accounts.close()
  }
})

test('prepared injected library opens without initialization', () => {
  const library = new LibraryRepository(prepareManagedDatabase())
  library.close()
})

test('unprovisioned private workspace returns 503 without creating directories', () => {
  const directory = mkdtempSync(join(tmpdir(), 'managed-private-'))
  writeFileSync(join(directory, 'READY'), '1\n')
  const users = join(directory, 'users')
  try {
    assert.throws(() => new PrivateLibraries(users).open('11111111-1111-1111-1111-111111111111'), {
      status: 503,
    })
    assert.equal(existsSync(users), false)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('runtime sources cannot contain schema administration or admin imports', async () => {
  const { readdirSync, readFileSync } = await import('node:fs')
  const root = new URL('../src/server/', import.meta.url)
  for (const file of readdirSync(root, { recursive: true })) {
    if (typeof file !== 'string' || !file.endsWith('.ts')) {
      continue
    }
    const source = readFileSync(new URL(file, root), 'utf8')
    assert.doesNotMatch(source, /\b(?:CREATE|ALTER|DROP)\s+(?:TABLE|INDEX|TRIGGER)\b/i, file)
    assert.doesNotMatch(
      source,
      /PRAGMA\s+(?:\w+\.)?(?:application_id|user_version|journal_mode|secure_delete)\s*=/i,
      file,
    )
    assert.doesNotMatch(
      source,
      /(?:from\s*|import\s*\()['"][^'"]*(?:database\/|migrate-private-study|study-schema|study-separation|library-visibility-schema)/,
      file,
    )
  }
})

import { symlinkSync, writeFileSync } from 'node:fs'
import { openManagedDatabase } from '../src/server/questions/managed-database.ts'

for (const marker of ['absent', 'bad', 'symlink', 'blocked'] as const) {
  test(`deployment readiness rejects ${marker} before opening central`, () => {
    const directory = mkdtempSync(join(tmpdir(), 'managed-ready-'))
    const path = join(directory, 'central.sqlite3')
    prepareManagedDatabase(path).close()
    if (marker === 'bad') {
      writeFileSync(join(directory, 'READY'), '1')
    }
    if (marker === 'symlink') {
      symlinkSync(path, join(directory, 'READY'))
    }
    if (marker === 'blocked') {
      writeFileSync(join(directory, 'READY'), '1\n')
      writeFileSync(join(directory, 'RESTART_BLOCKED'), '')
    }
    try {
      assert.throws(() => openManagedDatabase(path), /external|READY|maintenance/i)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
}

test('personal opens enforce deployment root even with custom workspace directory', () => {
  const directory = mkdtempSync(join(tmpdir(), 'managed-custom-'))
  const custom = mkdtempSync(join(tmpdir(), 'managed-custom-users-'))
  const owner = '11111111-1111-1111-1111-111111111111'
  prepareManagedDatabase(join(custom, `${owner}.sqlite3`), owner).close()
  writeFileSync(join(directory, 'READY'), '1\n')
  const libraries = new PrivateLibraries(custom, directory)
  try {
    libraries.open(owner).close()
    writeFileSync(join(directory, 'RESTART_BLOCKED'), '')
    assert.throws(() => libraries.open(owner), /external/i)
  } finally {
    rmSync(directory, { recursive: true, force: true })
    rmSync(custom, { recursive: true, force: true })
  }
})

for (const damage of [
  'owner',
  'history',
  'missing-column',
  'foreign',
  'future',
  'legacy',
] as const) {
  test(`personal ${damage} rejection leaves bytes and permissions untouched`, async () => {
    const { readFileSync, chmodSync, statSync } = await import('node:fs')
    const directory = mkdtempSync(join(tmpdir(), 'managed-personal-reject-'))
    const owner = '11111111-1111-1111-1111-111111111111'
    const path = join(directory, `${owner}.sqlite3`)
    const db = prepareManagedDatabase(path, owner)
    if (damage === 'owner') {
      db.exec("UPDATE private_library_owner SET account_id = 'not-a-canonical-owner'")
    }
    if (damage === 'foreign') {
      db.exec('PRAGMA application_id = 17')
    }
    if (damage === 'future') {
      db.exec('PRAGMA user_version = 5')
    }
    if (damage === 'legacy') {
      db.exec('PRAGMA user_version = 3')
    }
    if (damage === 'history') {
      db.exec('DELETE FROM flyway_schema_history')
    }
    if (damage === 'missing-column') {
      db.exec('ALTER TABLE reviewed_concepts RENAME COLUMN normalized_name TO incompatible')
    }
    db.close()
    writeFileSync(join(directory, 'READY'), '1\n')
    chmodSync(directory, 0o750)
    chmodSync(path, 0o640)
    const before = readFileSync(path)
    try {
      assert.throws(
        () => new PrivateLibraries(directory, directory).open(owner),
        /external.*preparation/i,
      )
      assert.deepEqual(readFileSync(path), before)
      assert.equal(statSync(directory).mode & 0o777, 0o750)
      assert.equal(statSync(path).mode & 0o777, 0o640)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
}

test('transitive runtime source imports cannot reach external database administration', async () => {
  const { readFileSync, readdirSync } = await import('node:fs')
  const { resolve, dirname, relative } = await import('node:path')
  const root = resolve('src')
  const seen = new Set<string>()

  function inspect(path: string): void {
    if (seen.has(path)) {
      return
    }
    seen.add(path)
    assert.ok(!relative(root, path).startsWith('..'), `Runtime import escaped source tree: ${path}`)
    const source = readFileSync(path, 'utf8')
    for (const match of source.matchAll(/(?:from\s*|import\s*\()['"]([^'"]+)['"]/g)) {
      const specifier = match[1]!
      if (!specifier.startsWith('.')) {
        continue
      }
      const target = resolve(dirname(path), specifier)
      assert.doesNotMatch(target, /\/database\/|\.sql$/, path)
      if (target.endsWith('.ts')) {
        inspect(target)
      }
    }
  }

  for (const file of readdirSync(resolve(root, 'server'), { recursive: true })) {
    if (typeof file === 'string' && file.endsWith('.ts')) {
      inspect(resolve(root, 'server', file))
    }
  }
})

test('prepared central permissions are restricted only after successful read-only validation', async () => {
  const { chmodSync, statSync } = await import('node:fs')
  const directory = mkdtempSync(join(tmpdir(), 'managed-central-permissions-'))
  const path = join(directory, 'central.sqlite3')
  prepareManagedDatabase(path).close()
  writeFileSync(join(directory, 'READY'), '1\n')
  chmodSync(path, 0o640)
  try {
    openManagedDatabase(path).close()
    assert.equal(statSync(path).mode & 0o777, 0o600)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
