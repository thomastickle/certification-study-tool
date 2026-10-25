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
  if (!existsSync(path)) {
    throw new Error('No account registry found. Start the app and sign in first.')
  }
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

type MigrationPaths = {
  directory: string
  account: MigrationAccount
  source: string
  target: string
}

type ValidatedSource = { raw: string; staged: string; counts: MigrationResult['counts'] }

/** Copy the chosen owner's library through validation and install while holding one data lock.
 * @throws {Error} When the app is running, owner/source is invalid, or destination is not pristine.
 */
export async function migrateLibrary(options: MigrationOptions): Promise<MigrationResult> {
  const paths = resolveOwnerAndPaths(options)
  const release = lockDataDirectory(paths.directory)
  try {
    assertPristine(paths.target)
    const temporary = mkdtempSync(join(paths.directory, '.library-migration-'))
    try {
      const snapshot = await stageValidatedSource(paths.source, temporary)
      const preview: MigrationResult = {
        applied: false,
        account: paths.account,
        source: paths.source,
        target: paths.target,
        counts: snapshot.counts,
      }
      if (!options.apply) {
        return preview
      }
      return await backupAndInstall(paths, snapshot, preview)
    } finally {
      rmSync(temporary, { recursive: true, force: true })
    }
  } finally {
    release()
  }
}

/** Resolve an explicit existing owner and separate source/destination before acquiring resources. */
function resolveOwnerAndPaths(options: MigrationOptions): MigrationPaths {
  const directory = resolve(options.dataDirectory)
  if (!accountIdPattern.test(options.accountId)) {
    throw new Error('Choose a valid account ID from --list-accounts.')
  }
  const account = migrationAccounts(directory).find((account) => account.id === options.accountId)
  if (!account) {
    throw new Error('The selected account does not exist. Sign in and list accounts first.')
  }
  const source = resolve(options.source ?? join(directory, 'library.sqlite3'))
  const target = join(directory, 'users', account.id + '.sqlite3')
  if (!existsSync(source) || source === target) {
    throw new Error('Choose an existing, separate legacy database as the source.')
  }
  return { directory, account, source, target }
}

/** Validate a read-only source snapshot separately; each database handle closes before returning. */
async function stageValidatedSource(source: string, temporary: string): Promise<ValidatedSource> {
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
  return { raw, staged, counts }
}

/** Retain durable backups and revalidate immediately before atomic installation under the caller's lock. */
async function backupAndInstall(
  paths: MigrationPaths,
  snapshot: ValidatedSource,
  preview: MigrationResult,
): Promise<MigrationResult> {
  const result = { ...preview }
  const backups = join(paths.directory, 'backups')
  mkdirSync(backups, { recursive: true, mode: 0o700 })
  const stamp = randomUUID()
  result.backup = join(backups, `legacy-${stamp}.sqlite3`)
  copyFileSync(snapshot.raw, result.backup, constants.COPYFILE_EXCL)
  chmodSync(result.backup, 0o600)
  if (existsSync(paths.target)) {
    result.previousWorkspaceBackup = join(backups, `empty-workspace-${stamp}.sqlite3`)
    const empty = new DatabaseSync(paths.target, { readOnly: true })
    try {
      await backup(empty, result.previousWorkspaceBackup)
    } finally {
      empty.close()
    }
    chmodSync(result.previousWorkspaceBackup, 0o600)
  }
  // The shared data lock excludes server requests during the final validation and atomic install.
  assertPristine(paths.target)
  mkdirSync(join(paths.directory, 'users'), { recursive: true, mode: 0o700 })
  chmodSync(snapshot.staged, 0o600)
  renameSync(snapshot.staged, paths.target)
  return { ...result, applied: true }
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

/** Coordinate independent filesystem and database-content checks for an unused target. */
function assertPristine(target: string): void {
  if (!assertSafeTargetFile(target)) {
    return
  }
  const db = new DatabaseSync(target, { readOnly: true })
  try {
    assertEmptyLibraryContents(db)
  } finally {
    db.close()
  }
}

/** Refuse sidecars and non-regular targets; return whether a safe target file exists. */
function assertSafeTargetFile(target: string): boolean {
  for (const suffix of ['-wal', '-shm', '-journal']) {
    if (existsSync(target + suffix)) {
      throw new Error(
        'The target has SQLite sidecars. Close database tools and checkpoint it before migrating.',
      )
    }
  }
  if (!existsSync(target)) {
    return false
  }
  if (!lstatSync(target).isFile()) {
    throw new Error('The target must be a regular database file.')
  }
  return true
}

/** Reject unknown schemas and any revision or content indicating prior workspace use. */
function assertEmptyLibraryContents(db: DatabaseSync): void {
  assertLibrary(db)
  if (Number(db.prepare('SELECT revision FROM library_state WHERE id = 1').get()?.revision) !== 0) {
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
    if (metadata.has(table)) {
      continue
    }
    if (!data.has(table)) {
      throw new Error('Unsupported target workspace schema. Use the current app version.')
    }
    // Only fixed names from the allowlist above are interpolated into SQL.
    if (Number(db.prepare(`SELECT count(*) AS total FROM ${table}`).get()?.total) !== 0) {
      throw new Error(
        'The target workspace is not empty. Migration never overwrites used workspaces.',
      )
    }
  }
}
