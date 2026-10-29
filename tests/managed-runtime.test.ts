import assert from 'node:assert/strict'
import { mkdtempSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { AccountRepository } from '../src/server/auth/account-repository.ts'

test('missing central database fails without creating a file', () => {
  const directory = mkdtempSync(join(tmpdir(), 'managed-runtime-'))
  const path = join(directory, 'central.sqlite3')
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
  ['incomplete', 'UPDATE private_study_separation SET complete = 0'],
  ['missing projection table', 'DROP TABLE quiz_evidence'],
]) {
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
    if (typeof file !== 'string' || !file.endsWith('.ts')) continue
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
