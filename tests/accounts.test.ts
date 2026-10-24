import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { AccountRepository } from '../src/server/auth/account-repository.ts'

test('account identity survives restart, ignores display name changes, and separates issuers', () => {
  const directory = mkdtempSync(join(tmpdir(), 'study-accounts-'))
  const path = join(directory, 'accounts.sqlite3')
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

test('sessions persist as hashes, expire at their deadline, and can be revoked', () => {
  const directory = mkdtempSync(join(tmpdir(), 'study-sessions-'))
  const path = join(directory, 'accounts.sqlite3')
  let accounts = new AccountRepository(path)
  try {
    const account = accounts.identify({
      issuer: 'https://id.example',
      subject: 'alice',
      name: 'Alice',
    })
    const token = 'synthetic-browser-session-credential'
    accounts.saveSession(token, account.id, 2000)
    assert.deepEqual(accounts.session(token, 1000), account)
    accounts.close()
    accounts = new AccountRepository(path)
    assert.deepEqual(accounts.session(token, 1999), account)
    assert.equal(accounts.session('unknown', 1000), undefined)
    assert.equal(accounts.session(token, 2000), undefined)
    accounts.saveSession(token, account.id, 3000)
    accounts.revokeSession(token)
    assert.equal(accounts.session(token, 2001), undefined)
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
