import { prepareRuntimeDatabase, provisionTestWorkspace } from './managed-database-fixture.ts'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { once } from 'node:events'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { AccountRepository } from '../src/server/auth/account-repository.ts'
import { LibraryRepository } from '../src/server/questions/library-repository.ts'
import { PrivateLibraries } from '../src/server/questions/private-libraries.ts'
import { LibraryService } from '../src/server/questions/library-service.ts'
import { QuizService } from '../src/server/quizzes/quiz-service.ts'
import { populate } from './quiz-fixtures.ts'

for (const damage of ['corrupt', 'foreign-owner'] as const) {
  test(`actual server restarts with a ${damage} private file and maintains later healthy accounts`, async () => {
    const directory = mkdtempSync(join(tmpdir(), 'study-housekeeping-'))
    const port = await availablePort()
    const origin = `http://127.0.0.1:${port}`
    const issuer = 'http://127.0.0.1:8080/realms/housekeeping-test'
    const accountsPath = join(directory, 'library.sqlite3')
    const sharedPath = join(directory, 'library.sqlite3')
    const usersPath = join(directory, 'users')
    prepareRuntimeDatabase(sharedPath)
    const accounts = new AccountRepository(accountsPath)
    const libraries = new PrivateLibraries(usersPath)
    const sessions = new Map<string, string>()
    for (let index = 0; index < 3; index++) {
      const account = accounts.identify({ issuer, subject: String(index), name: 'Synthetic owner' })
      const token = randomBytes(32).toString('base64url')
      accounts.saveSession(token, account.id, Date.now() + 60_000)
      sessions.set(account.id, token)
      provisionTestWorkspace(sharedPath, usersPath, account.id)
      libraries.open(account.id).close()
    }
    accounts.close()
    const [first, damaged, last] = libraries.accounts() as [string, string, string]
    const healthy = [first, last]
    const shared = new LibraryRepository(sharedPath)
    populate(shared)
    const attempts = new Map<string, string>()
    for (const accountId of healthy) {
      const personal = libraries.open(accountId)
      try {
        const study = shared.forAccount(accountId, personal)
        const quiz = new QuizService(study, () => Date.now() - 30 * 60_000).start({
          sourceFilter: 'mixed',
          questionType: 'mixed',
        })
        attempts.set(accountId, quiz.id)
      } finally {
        personal.close()
      }
    }
    new LibraryService(shared).deleteSource(shared.sources()[0]!.id)
    // The completed migration remains authoritative; routine upkeep alone encounters the damage.
    shared.close()
    const damagedPath = join(usersPath, `${damaged}.sqlite3`)
    if (damage === 'corrupt') {
      writeFileSync(damagedPath, 'Synthetic private content that must never enter logs')
    } else {
      const wrongOwner = new DatabaseSync(damagedPath)
      wrongOwner.prepare('UPDATE private_library_owner SET account_id = ?').run(first)
      wrongOwner.close()
    }
    const damagedBytes = readFileSync(damagedPath)
    const environment = {
      ...process.env,
      NODE_ENV: 'development',
      STUDY_HOST: '127.0.0.1',
      STUDY_PORT: String(port),
      STUDY_ORIGIN: origin,
      STUDY_OIDC_ISSUER: issuer,
      STUDY_DB_PATH: sharedPath,
      STUDY_PRIVATE_LIBRARIES_DIR: usersPath,
      STUDY_LEGACY_OWNER_SUBJECT: '',
    }
    const child = spawn(process.execPath, ['build/src/server/main.js'], {
      env: environment,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const exit = once(child, 'exit')
    let errors = ''
    child.stderr.on('data', (chunk) => (errors += String(chunk)))
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Server startup timed out')), 10000)
        child.stdout.on('data', (chunk) => {
          if (String(chunk).includes('Certification Study Tool:')) {
            clearTimeout(timer)
            resolve()
          }
        })
        child.once('exit', () => {
          clearTimeout(timer)
          reject(new Error('Server exited before startup with a damaged private file'))
        })
      })
      // Inspect files before HTTP requests can trigger lazy expiry/reconciliation themselves.
      for (const accountId of healthy) {
        const personal = libraries.open(accountId)
        try {
          const saved = personal.quizStore().find(attempts.get(accountId)!)!
          assert.equal(saved.status, 'completed', 'Expiry must continue past the damaged owner')
          assert.deepEqual(saved.deletedBankNames, ['quiz-synthetic'])
          assert.equal(personal.sharedDeletionCursor(), 1)
        } finally {
          personal.close()
        }
      }
      assert.equal((await fetch(`${origin}/api/health`)).status, 200)
      for (const accountId of healthy) {
        const headers = {
          Cookie: `study_session=${sessions.get(accountId)}`,
          'X-Study-Account': accountId,
        }
        const response = await fetch(`${origin}/api/quizzes/${attempts.get(accountId)}`, {
          headers,
        })
        assert.equal(response.status, 200)
        assert.equal((await response.json()).status, 'completed')
      }
      // New work added after startup must still be scored by the recurring pass past this bad file.
      const content = new LibraryRepository(sharedPath)
      const personal = libraries.open(last)
      let laterAttempt: string
      try {
        populate(personal)
        const study = content.forAccount(last, personal)
        laterAttempt = new QuizService(study, () => Date.now() - 30 * 60_000).start({
          sourceFilter: 'mixed',
          questionType: 'mixed',
        }).id
      } finally {
        personal.close()
        content.close()
      }
      const deadline = Date.now() + 7000
      while (true) {
        const check = new DatabaseSync(join(usersPath, `${last}.sqlite3`), {
          readOnly: true,
          timeout: 5000,
        })
        let status: string | undefined
        try {
          const row = check
            .prepare('SELECT status FROM quiz_sessions WHERE account_id = ? AND id = ?')
            .get(last, laterAttempt)
          status = row?.status as string | undefined
        } finally {
          check.close()
        }
        if (status === 'completed') {
          break
        }
        assert.ok(
          Date.now() < deadline,
          'Recurring housekeeping must continue past the damaged owner',
        )
        await delay(50)
      }
      assert.equal((await fetch(`${origin}/api/health`)).status, 200)
      assert.deepEqual(readFileSync(damagedPath), damagedBytes, 'Never overwrite the damaged file')
      assert.ok(errors.includes(damaged), 'A sanitized failure identifies the affected account')
      assert.equal(errors.includes(usersPath), false, 'Logs must not reveal storage paths')
      assert.equal(errors.includes('Synthetic private content'), false)
      assert.equal(errors.includes('Error:'), false, 'Do not log raw database errors or stacks')
    } finally {
      child.kill('SIGTERM')
      await exit
      rmSync(directory, { recursive: true, force: true })
    }
  })
}

test('actual startup still refuses a damaged destination with incomplete external shared study separation', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'study-migration-fail-closed-'))
  const port = await availablePort()
  const sharedPath = join(directory, 'library.sqlite3')
  const usersPath = join(directory, 'users')
  prepareRuntimeDatabase(sharedPath)
  const accounts = new AccountRepository(sharedPath)
  const account = accounts.identify({
    issuer: 'synthetic',
    subject: 'owner',
    name: 'Synthetic owner',
  })
  accounts.close()
  const shared = new LibraryRepository(sharedPath)
  shared.forAccount(account.id).quizStore().record('preserve-pending-migration', false)
  shared.close()
  const libraries = new PrivateLibraries(usersPath)
  provisionTestWorkspace(sharedPath, usersPath, account.id)
  libraries.open(account.id).close()
  const pending = new DatabaseSync(sharedPath)
  pending.exec('UPDATE private_study_separation SET complete = 0')
  pending.close()
  const damagedPath = join(usersPath, `${account.id}.sqlite3`)
  writeFileSync(damagedPath, 'Synthetic corrupt destination')
  const child = spawn(process.execPath, ['build/src/server/main.js'], {
    env: {
      ...process.env,
      NODE_ENV: 'development',
      STUDY_HOST: '127.0.0.1',
      STUDY_PORT: String(port),
      STUDY_ORIGIN: `http://127.0.0.1:${port}`,
      STUDY_OIDC_ISSUER: 'http://127.0.0.1:8080/realms/housekeeping-test',
      STUDY_DB_PATH: sharedPath,
      STUDY_PRIVATE_LIBRARIES_DIR: usersPath,
      STUDY_LEGACY_OWNER_SUBJECT: '',
    },
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  const exit = once(child, 'exit')
  let listening = false
  child.stdout.on('data', (chunk) => {
    listening ||= String(chunk).includes('Certification Study Tool:')
  })
  const timeout = setTimeout(() => child.kill('SIGTERM'), 10000)
  try {
    const [code] = await exit
    assert.notEqual(code, null, 'The application must exit on its own migration error')
    assert.notEqual(code, 0)
    assert.equal(listening, false)
    const check = new DatabaseSync(sharedPath, { readOnly: true })
    try {
      assert.deepEqual(
        check
          .prepare('SELECT DISTINCT account_id FROM quiz_mastery')
          .all()
          .map((row) => row.account_id),
        [account.id],
      )
    } finally {
      check.close()
    }
    assert.equal(readFileSync(damagedPath, 'utf8'), 'Synthetic corrupt destination')
  } finally {
    clearTimeout(timeout)
    child.kill('SIGTERM')
    await exit
    rmSync(directory, { recursive: true, force: true })
  }
})

/** Reserve an ephemeral loopback port for the actual entry-point child process. */
async function availablePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  await new Promise<void>((resolve) => server.close(() => resolve()))
  return address.port
}
