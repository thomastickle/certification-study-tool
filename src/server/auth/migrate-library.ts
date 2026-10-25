import { randomUUID } from 'node:crypto'
import {
  chmodSync,
  constants,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
} from 'node:fs'
import { join, resolve } from 'node:path'
import { backup, DatabaseSync } from 'node:sqlite'
import { LibraryRepository } from '../questions/library-repository.ts'
import { lockDataDirectory } from './data-lock.ts'

export type MigrationOptions = {
  dataDirectory: string
  accountId: string
  source?: string
  apply?: boolean
}

export type MigrationAccount = { id: string; name: string; issuer: string }

export type MigrationResult = {
  applied: boolean
  account: MigrationAccount
  source: string
  target: string
  counts: { sources: number; questions: number; attempts: number }
  backup?: string
  previousWorkspaceBackup?: string
}

const accountIdPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/

/** Read account choices without creating a registry or exposing session credentials.
 * @throws {Error} When no recognized account registry exists; sign in before migrating.
 */
export function migrationAccounts(dataDirectory: string): MigrationAccount[] {
  const path = join(resolve(dataDirectory), 'accounts.sqlite3')
  if (!existsSync(path))
    throw new Error('No account registry found. Start the app and sign in first.')
  const accounts = new DatabaseSync(path, { readOnly: true })
  try {
    if (
      Number(accounts.prepare('PRAGMA application_id').get()?.application_id) !== 1096242005 ||
      Number(accounts.prepare('PRAGMA user_version').get()?.user_version) !== 1
    ) {
      throw new Error('Unrecognized account registry.')
    }
    return accounts
      .prepare('SELECT id, name, issuer FROM accounts ORDER BY name, id')
      .all() as MigrationAccount[]
  } finally {
    accounts.close()
  }
}

/** Copy one legacy library only after choosing its owner; never assign it to other accounts.
 * @throws {Error} When the app is running, the owner/source is invalid, or the target is not pristine.
 */
export async function migrateLibrary(options: MigrationOptions): Promise<MigrationResult> {
  const directory = resolve(options.dataDirectory)
  if (!accountIdPattern.test(options.accountId))
    throw new Error('Choose a valid account ID from --list-accounts.')
  const account = migrationAccounts(directory).find((account) => account.id === options.accountId)
  if (!account)
    throw new Error('The selected account does not exist. Sign in and list accounts first.')
  const source = resolve(options.source ?? join(directory, 'library.sqlite3'))
  const target = join(directory, 'users', account.id + '.sqlite3')
  if (!existsSync(source) || source === target)
    throw new Error('Choose an existing, separate legacy database as the source.')
  const release = lockDataDirectory(directory)
  let temporary: string | undefined
  try {
    assertPristine(target)
    temporary = mkdtempSync(join(directory, '.library-migration-'))
    const raw = join(temporary, 'original.sqlite3')
    const staged = join(temporary, 'validated.sqlite3')
    const original = new DatabaseSync(source, { readOnly: true })
    try {
      assertLibrary(original)
      await backup(original, raw)
    } finally {
      original.close()
    }
    chmodSync(raw, 0o600)
    copyFileSync(raw, staged, constants.COPYFILE_EXCL)
    const validated = new LibraryRepository(staged)
    let counts: MigrationResult['counts']
    try {
      counts = {
        sources: validated.sources().length,
        questions: validated.allQuestions().length,
        attempts: validated.quizStore().snapshots().length,
      }
    } finally {
      validated.close()
    }
    const result: MigrationResult = { applied: false, account, source, target, counts }
    if (!options.apply) return result
    const backups = join(directory, 'backups')
    mkdirSync(backups, { recursive: true, mode: 0o700 })
    const stamp = randomUUID()
    result.backup = join(backups, `legacy-${stamp}.sqlite3`)
    copyFileSync(raw, result.backup, constants.COPYFILE_EXCL)
    chmodSync(result.backup, 0o600)
    if (existsSync(target)) {
      result.previousWorkspaceBackup = join(backups, `empty-workspace-${stamp}.sqlite3`)
      const empty = new DatabaseSync(target, { readOnly: true })
      try {
        await backup(empty, result.previousWorkspaceBackup)
      } finally {
        empty.close()
      }
      chmodSync(result.previousWorkspaceBackup, 0o600)
    }
    // The shared data lock excludes server requests during the final validation and atomic install.
    assertPristine(target)
    mkdirSync(join(directory, 'users'), { recursive: true, mode: 0o700 })
    chmodSync(staged, 0o600)
    renameSync(staged, target)
    return { ...result, applied: true }
  } finally {
    if (temporary) rmSync(temporary, { recursive: true, force: true })
    release()
  }
}

/** Validate recognized app data without opening the original through a migrating repository. */
function assertLibrary(db: DatabaseSync): void {
  const version = Number(db.prepare('PRAGMA user_version').get()?.user_version)
  if (
    Number(db.prepare('PRAGMA application_id').get()?.application_id) !== 1096242004 ||
    ![1, 2].includes(version)
  ) {
    throw new Error('The source or workspace is not a recognized study database.')
  }
  if (db.prepare('PRAGMA integrity_check').get()?.integrity_check !== 'ok') {
    throw new Error(
      'Database integrity check failed. Restore a known-good backup before migrating.',
    )
  }
}

/** Refuse active sidecars, unknown schemas, and any evidence of prior workspace use. */
function assertPristine(target: string): void {
  for (const suffix of ['-wal', '-shm', '-journal']) {
    if (existsSync(target + suffix))
      throw new Error(
        'The target has SQLite sidecars. Close database tools and checkpoint it before migrating.',
      )
  }
  if (!existsSync(target)) return
  if (!lstatSync(target).isFile()) throw new Error('The target must be a regular database file.')
  const db = new DatabaseSync(target, { readOnly: true })
  try {
    assertLibrary(db)
    if (
      Number(db.prepare('SELECT revision FROM library_state WHERE id = 1').get()?.revision) !== 0
    ) {
      throw new Error(
        'The target workspace is not empty. Migration never overwrites used workspaces.',
      )
    }
    const metadata = new Set(['library_state', 'concept_schema', 'certification_schema'])
    const data = new Set([
      'sources',
      'questions',
      'quiz_sessions',
      'quiz_mastery',
      'reviewed_concepts',
      'dismissed_concept_suggestions',
      'earned_certifications',
    ])
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all()
    for (const row of tables) {
      const table = String(row.name)
      if (metadata.has(table)) continue
      if (!data.has(table))
        throw new Error('Unsupported target workspace schema. Use the current app version.')
      // Only fixed names from the allowlist above are interpolated into SQL.
      if (Number(db.prepare(`SELECT count(*) AS total FROM ${table}`).get()?.total) !== 0) {
        throw new Error(
          'The target workspace is not empty. Migration never overwrites used workspaces.',
        )
      }
    }
  } finally {
    db.close()
  }
}
