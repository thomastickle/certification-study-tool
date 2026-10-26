import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { AccountRepository } from '../src/server/auth/account-repository.ts'

test('operator revocation requires an exact identity and leaves other accounts signed in', () => {
  const directory = mkdtempSync(join(tmpdir(), 'study-session-revocation-'))
  const path = join(directory, 'accounts.sqlite3')
  const accounts = new AccountRepository(path)
  const issuer = 'https://identity.example/realm'
  try {
    const alice = accounts.identify({ issuer, subject: 'alice', name: 'Alice' })
    const bob = accounts.identify({ issuer, subject: 'bob', name: 'Bob' })
    accounts.saveSession('first-alice-session', alice.id, 2000, 'admin')
    accounts.saveSession('second-alice-session', alice.id, 2000, 'admin')
    accounts.saveSession('bob-session', bob.id, 2000, 'student')

    function revoke(identityIssuer: string) {
      return spawnSync(
        process.execPath,
        [
          'src/server/auth/revoke-sessions.ts',
          '--accounts',
          path,
          '--issuer',
          identityIssuer,
          '--subject',
          'alice',
        ],
        { encoding: 'utf8', timeout: 10_000 },
      )
    }

    const refused = revoke('https://other.example/realm')
    assert.equal(refused.status, 1)
    assert.ok(accounts.session('first-alice-session', 1000, issuer))
    const success = revoke(issuer)
    assert.equal(success.status, 0, success.stderr)
    assert.equal(accounts.session('first-alice-session', 1000, issuer), undefined)
    assert.equal(accounts.session('second-alice-session', 1000, issuer), undefined)
    assert.equal(accounts.session('bob-session', 1000, issuer)?.id, bob.id)
    assert.doesNotMatch(success.stdout, /alice|bob-session|first-alice-session/)
  } finally {
    accounts.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
