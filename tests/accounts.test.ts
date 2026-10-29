import { prepareManagedDatabase, prepareRuntimeDatabase } from './managed-database-fixture.ts'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { AccountRepository } from '../src/server/auth/account-repository.ts'
import { createHash, randomUUID } from 'node:crypto'

test('account identity survives restart, ignores display name changes, and separates issuers', () => {
  const directory = mkdtempSync(join(tmpdir(), 'study-accounts-'))
  const path = join(directory, 'accounts.sqlite3')
  prepareRuntimeDatabase(path)
  const identity = { issuer: 'https://identity.example/realm', subject: 'alice', name: 'Alice' }
  let accounts = new AccountRepository(path)
  try {
    const original = accounts.identify(identity)
    assert.match(original.id, /^[a-f0-9-]{36}$/)
    accounts.close()
    accounts = new AccountRepository(path)
    const renamed = accounts.identify({ ...identity, name: 'Alice Renamed' })
    assert.equal(renamed.id, original.id)
    assert.equal(renamed.name, 'Alice Renamed')
    assert.notEqual(accounts.identify({ ...identity, subject: 'bob' }).id, original.id)
    assert.notEqual(
      accounts.identify({ ...identity, issuer: 'https://other.example' }).id,
      original.id,
    )
  } finally {
    accounts.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('sessions retain their verified role and only resolve under the configured issuer', () => {
  const accounts = new AccountRepository(prepareManagedDatabase())
  const issuer = 'https://identity.example/realm'
  try {
    const account = accounts.identify({ issuer, subject: 'alice', name: 'Alice' })
    accounts.saveSession('admin-session', account.id, 2000, 'admin')
    accounts.saveSession('student-session', account.id, 2000, 'student')
    assert.equal(accounts.session('admin-session', 1000, issuer)?.role, 'admin')
    assert.equal(accounts.session('student-session', 1000, issuer)?.role, 'student')
    assert.equal(accounts.session('admin-session', 1000, 'https://other.example/realm'), undefined)
    accounts.revokeAccountSessions(account.id)
    assert.equal(accounts.session('admin-session', 1000, issuer), undefined)
    assert.equal(accounts.session('student-session', 1000, issuer), undefined)
  } finally {
    accounts.close()
  }
})

test('prepared existing account sessions preserve identity and default to student', () => {
  const directory = mkdtempSync(join(tmpdir(), 'study-session-upgrade-'))
  const path = join(directory, 'accounts.sqlite3')
  prepareRuntimeDatabase(path)
  const id = randomUUID()
  const issuer = 'https://identity.example/realm'
  const token = 'synthetic-pre-upgrade-session'
  const original = new DatabaseSync(path)
  try {
    original.prepare('INSERT INTO accounts VALUES (?, ?, ?, ?)').run(id, issuer, 'alice', 'Alice')
    const hash = createHash('sha256').update(token).digest('hex')
    original
      .prepare('INSERT INTO sessions(token_hash, account_id, expires_at) VALUES (?, ?, ?)')
      .run(hash, id, 2000)
  } finally {
    original.close()
  }
  const accounts = new AccountRepository(path)
  try {
    assert.equal(accounts.findIdentity(issuer, 'alice')?.id, id)
    assert.equal(accounts.session(token, 1000, issuer)?.id, id)
    assert.equal(accounts.session(token, 1000, issuer)?.role, 'student')
    accounts.saveSession('new-admin-session', id, 2000, 'admin')
    assert.equal(accounts.session('new-admin-session', 1000, issuer)?.role, 'admin')
    assert.equal(accounts.session(token, 1000, issuer)?.role, 'student')
  } finally {
    accounts.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('sessions persist as hashes, expire at their deadline, and can be revoked', () => {
  const directory = mkdtempSync(join(tmpdir(), 'study-sessions-'))
  const path = join(directory, 'accounts.sqlite3')
  prepareRuntimeDatabase(path)
  let accounts = new AccountRepository(path)
  try {
    const account = accounts.identify({
      issuer: 'https://id.example',
      subject: 'alice',
      name: 'Alice',
    })
    const token = 'synthetic-browser-session-credential'
    accounts.saveSession(token, account.id, 2000)
    assert.deepEqual(
      { ...accounts.session(token, 1000, 'https://id.example') },
      { ...account, role: 'student' },
    )
    accounts.close()
    accounts = new AccountRepository(path)
    assert.deepEqual(
      { ...accounts.session(token, 1999, 'https://id.example') },
      { ...account, role: 'student' },
    )
    assert.equal(accounts.session('unknown', 1000, 'https://id.example'), undefined)
    assert.equal(accounts.session(token, 2000, 'https://id.example'), undefined)
    // Expiration rejects the token immediately; explicit housekeeping reclaims its stored record.
    const expired = new DatabaseSync(path, { readOnly: true })
    try {
      assert.equal(expired.prepare('SELECT count(*) AS total FROM sessions').get()?.total, 1)
      accounts.pruneExpiredSessions(2000)
      assert.equal(expired.prepare('SELECT count(*) AS total FROM sessions').get()?.total, 0)
    } finally {
      expired.close()
    }
    accounts.saveSession(token, account.id, 3000)
    accounts.revokeSession(token)
    assert.equal(accounts.session(token, 2001, 'https://id.example'), undefined)
    const db = new DatabaseSync(path)
    try {
      accounts.saveSession(token, account.id, 4000)
      assert.equal(
        JSON.stringify(db.prepare('SELECT * FROM sessions').all()).includes(token),
        false,
      )
    } finally {
      db.close()
    }
  } finally {
    accounts.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('session lookup remains available while another connection holds the write reservation', () => {
  const directory = mkdtempSync(join(tmpdir(), 'study-session-read-'))
  const path = join(directory, 'accounts.sqlite3')
  prepareRuntimeDatabase(path)
  const accounts = new AccountRepository(path)
  const writer = new DatabaseSync(path)
  try {
    const account = accounts.identify({
      issuer: 'https://id.example',
      subject: 'alice',
      name: 'Alice',
    })
    accounts.saveSession('valid-session', account.id, 2000)
    accounts.saveSession('expired-session', account.id, 1000)
    writer.exec('BEGIN IMMEDIATE')
    assert.deepEqual(
      { ...accounts.session('valid-session', 1500, 'https://id.example') },
      { ...account, role: 'student' },
    )
    assert.equal(accounts.session('expired-session', 1500, 'https://id.example'), undefined)
  } finally {
    writer.close()
    accounts.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
