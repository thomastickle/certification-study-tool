import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { LibraryRepository } from '../src/server/questions/library-repository.ts'
import { PrivateLibraries } from '../src/server/questions/private-libraries.ts'

/** Write visible content without introducing a second transaction boundary. */
function saveSource(repository: Pick<LibraryRepository, 'saveSource'>, key: string) {
  return repository.saveSource('Example', 'DEMO-1', 'Demo', key, key, 'practice', '{}')
}

test('account views share nested savepoints and publish only the outer revision', () => {
  const root = new LibraryRepository(':memory:')
  try {
    const alice = root.forAccount('alice')
    const bob = root.forAccount('bob')
    root.transaction(() => {
      saveSource(alice, 'outer')
      alice.transaction(() => saveSource(bob, 'nested'))
      assert.equal(bob.revision(), 0)
      assert.throws(() => {
        bob.transaction(() => {
          saveSource(alice, 'rolled-back')
          throw new Error('inner failure')
        })
      }, /inner failure/)
      assert.deepEqual(
        alice.sources().map((source) => source.key),
        ['nested', 'outer'],
      )
    })
    assert.equal(alice.revision(), 1)
    assert.equal(bob.revision(), 1)
    assert.throws(() => {
      alice.transaction(() => {
        bob.transaction(() => saveSource(root, 'outer-rollback'))
        throw new Error('outer failure')
      })
    }, /outer failure/)
    assert.equal(root.revision(), 1)
    assert.deepEqual(
      root.sources().map((source) => source.key),
      ['nested', 'outer'],
    )
    bob.transaction(() => saveSource(alice, 'after-rollback'))
    assert.equal(root.revision(), 2)
  } finally {
    root.close()
  }
})

test('only the root can close its connection and shutdown closes it once', (context) => {
  const root = new LibraryRepository(':memory:')
  const alice = root.forAccount('alice')
  const bob = alice.forAccount('bob')
  const close = context.mock.method(DatabaseSync.prototype, 'close')
  try {
    assert.equal('close' in alice, false)
    assert.equal('close' in bob, false)
    alice.transaction(() => saveSource(bob, 'still-open'))
    assert.equal(root.sources().length, 1)
    root.close()
    root.close()
    assert.equal(close.mock.callCount(), 1)
    assert.throws(() => alice.sources(), /not open/)
    assert.throws(() => bob.sources(), /not open/)
  } finally {
    close.mock.restore()
    if (close.mock.callCount() === 0) {
      root.close()
    }
  }
})

test('failed database inspection closes the opened connection', (context) => {
  const directory = mkdtempSync(join(tmpdir(), 'library-initialization-'))
  const path = join(directory, 'invalid.sqlite3')
  writeFileSync(path, 'This is deliberately not a SQLite database.')
  const close = context.mock.method(DatabaseSync.prototype, 'close')
  try {
    assert.throws(() => new LibraryRepository(path), /not a database/)
    assert.equal(close.mock.callCount(), 1)
    const failedDatabase = close.mock.calls[0]!.this
    assert.ok(failedDatabase instanceof DatabaseSync)
    assert.equal(failedDatabase.isOpen, false)
  } finally {
    close.mock.restore()
    rmSync(directory, { recursive: true, force: true })
  }
})

for (const scenario of [
  {
    name: 'unrecognized schema',
    sql: 'CREATE TABLE unrelated (value TEXT)',
    error: /Unrecognized database/,
  },
  {
    name: 'unsupported version',
    sql: 'PRAGMA application_id = 1096242004; PRAGMA user_version = 99',
    error: /Unsupported database version/,
  },
  {
    name: 'migration failure',
    sql: `
      PRAGMA application_id = 1096242004;
      PRAGMA user_version = 1;
      CREATE TABLE quiz_sessions (id TEXT PRIMARY KEY);
    `,
    error: /quiz_sessions already exists/,
  },
]) {
  test(`initialization closes once after ${scenario.name} and leaves the file unchanged`, (context) => {
    const directory = mkdtempSync(join(tmpdir(), 'library-initialization-'))
    const path = join(directory, 'library.sqlite3')
    const fixture = new DatabaseSync(path)
    fixture.exec(scenario.sql)
    fixture.close()
    const before = readFileSync(path)
    const close = context.mock.method(DatabaseSync.prototype, 'close')
    try {
      assert.throws(() => new LibraryRepository(path), scenario.error)
      assert.equal(close.mock.callCount(), 1)
      const failedDatabase = close.mock.calls[0]!.this
      assert.ok(failedDatabase instanceof DatabaseSync)
      assert.equal(failedDatabase.isOpen, false)
      assert.deepEqual(readFileSync(path), before)
    } finally {
      close.mock.restore()
      rmSync(directory, { recursive: true, force: true })
    }
  })
}

test('request-owned private roots close independently and their views retain owner protection', () => {
  const directory = mkdtempSync(join(tmpdir(), 'library-request-'))
  const libraries = new PrivateLibraries(directory)
  const account = '00000000-0000-4000-8000-000000000001'
  const shared = new LibraryRepository(':memory:')
  const first = libraries.open(account)
  const second = libraries.open(account)
  try {
    const personal = first.forAccount(account)
    assert.equal('close' in personal, false)
    assert.throws(() => personal.forAccount('another-owner'), /another account/)
    assert.throws(() => shared.forAccount('another-owner', personal), /another account/)
    assert.throws(() => shared.forAccount(' '), /account ID is required/)
    first.close()
    assert.throws(() => personal.sources(), /not open/)
    second.transaction(() => saveSource(second, 'private-source'))
    assert.equal(second.sources().length, 1)
    assert.deepEqual(shared.sources(), [])
    second.close()
    const reopened = libraries.open(account)
    try {
      assert.equal(reopened.sources().length, 1)
      assert.equal(reopened.revision(), 1)
    } finally {
      reopened.close()
    }
    assert.deepEqual(shared.sources(), [])
  } finally {
    first.close()
    second.close()
    shared.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
