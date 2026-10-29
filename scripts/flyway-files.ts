import { createHash, randomUUID } from 'node:crypto'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  closeSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { backup, DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'

export type DatabaseKind = 'accounts' | 'shared' | 'personal'

export const image =
  'redgate/flyway@sha256:b45087cccd267d326c5fd776bc06e9690e83509ce8bbf47acd65f1aa4a4b8b86'

export const sqlRoot = fileURLToPath(new URL('../dev/flyway/', import.meta.url))

const ownerPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
const cleanupSql = `
  CREATE TABLE private_study_separation (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    complete INTEGER NOT NULL CHECK (complete IN (0, 1))
  );
`

type ValidationOptions = { unbound?: boolean; next?: boolean }

type TemplateManifest = {
  format: 1
  image: string
  migrationSha256: string
  databaseSha256: string
  schemaSha256: string
  historySha256: string
}

/** Hash immutable local artifacts; this is not a signature or a replacement for Flyway validate. */
export function sha256(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex')
}

/** Invalidate templates when any personal migration is added, removed or edited. */
function personalMigrationDigest(): string {
  const directory = join(sqlRoot, 'personal')
  const catalog = readdirSync(directory)
    .sort()
    .map((name) => ({
      name,
      content: readFileSync(join(directory, name), 'utf8'),
    }))
  return sha256(
    JSON.stringify({ catalog, config: readFileSync(join(sqlRoot, 'flyway.conf'), 'utf8') }),
  )
}

/** Reject links in every existing path component, including parent directories. */
export function rejectLinks(path: string): void {
  let current = resolve(path)
  while (true) {
    if (existsSync(current) || lstatExists(current)) {
      if (lstatSync(current).isSymbolicLink()) {
        throw new Error('Symbolic links are not allowed in prototype paths.')
      }
    }
    const parent = dirname(current)
    if (parent === current) {
      return
    }
    current = parent
  }
}

/** Detect dangling symlinks without following them. */
function lstatExists(path: string): boolean {
  try {
    lstatSync(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false
    }
    throw error
  }
}

/** Use a regular existing file, never SQLite's implicit file creation. */
export function requireFile(path: string): void {
  rejectLinks(path)
  if (!lstatSync(path).isFile()) {
    throw new Error('A regular database file is required.')
  }
}

/** Build an in-memory reference from checked-in SQL, independent of the candidate database. */
function reference(kind: DatabaseKind, next = false): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  try {
    db.exec(readFileSync(join(sqlRoot, kind, 'V1__current_schema.sql'), 'utf8'))
    if (next) {
      db.exec(readFileSync(join(sqlRoot, 'synthetic-next', 'V2__prototype_probe.sql'), 'utf8'))
    }
    return db
  } catch (error) {
    db.close()
    throw error
  }
}

/** Normalize formatting and SQLite's quoting of identifiers after table renames. */
function normalizeSql(sql: string): string {
  return sql
    .replace(/"([a-z_]+)"/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Capture tables, constraints, indices, triggers, columns and foreign keys, excluding Flyway metadata. */
export function schemaContract(db: DatabaseSync): string {
  const objects = db
    .prepare(
      `
      SELECT type, name, tbl_name, sql
      FROM sqlite_master
      WHERE name NOT LIKE 'sqlite_%' AND tbl_name != 'flyway_schema_history'
      ORDER BY type, name
    `,
    )
    .all()
    .map((row) => ({
      type: row.type,
      name: row.name,
      tbl_name: row.tbl_name,
      sql: normalizeSql(String(row.sql)),
    }))
  const tables = objects.filter((row) => row.type === 'table').map((row) => String(row.name))
  const contracts = tables.map((table) => ({
    table,
    columns: db.prepare(`PRAGMA table_xinfo("${table.replaceAll('"', '""')}")`).all(),
    foreignKeys: db.prepare(`PRAGMA foreign_key_list("${table.replaceAll('"', '""')}")`).all(),
    indices: db
      .prepare(`PRAGMA index_list("${table.replaceAll('"', '""')}")`)
      .all()
      .map((index) => ({
        unique: index.unique,
        origin: index.origin,
        partial: index.partial,
        columns: db
          .prepare(`PRAGMA index_xinfo("${String(index.name).replaceAll('"', '""')}")`)
          .all(),
      }))
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  }))
  return JSON.stringify({ objects, contracts })
}

/** Refuse a foreign, legacy, altered or wrong-owner database before any Flyway baseline write.
 * @throws {Error} When identity, exact current schema, ownership or integrity checks fail.
 */
export function validateCurrent(
  path: string,
  kind: DatabaseKind,
  owner?: string,
  options: ValidationOptions = {},
): void {
  requireFile(path)
  if (kind === 'personal' && !options.unbound && !ownerPattern.test(owner ?? '')) {
    throw new Error('A canonical internal owner ID is required.')
  }
  const expected = reference(kind, options.next)
  let db: DatabaseSync
  try {
    db = new DatabaseSync(path, { readOnly: true })
  } catch (error) {
    expected.close()
    throw error
  }
  try {
    const appId = db.prepare('PRAGMA application_id').get()?.application_id
    const version = db.prepare('PRAGMA user_version').get()?.user_version
    if (
      appId !== (kind === 'accounts' ? 1096242005 : 1096242004) ||
      version !== (kind === 'accounts' ? 2 : 4)
    ) {
      throw new Error('Unsupported database identity/version; legacy upgrades are not implemented.')
    }
    const hasCleanup = db
      .prepare("SELECT name FROM sqlite_master WHERE name = 'private_study_separation'")
      .get()
    if (kind === 'shared' && hasCleanup) {
      expected.exec(cleanupSql)
      const rows = db.prepare('SELECT singleton, complete FROM private_study_separation').all()
      if (
        rows.length !== 1 ||
        rows[0]?.singleton !== 1 ||
        ![0, 1].includes(Number(rows[0]?.complete))
      ) {
        throw new Error('Invalid shared cleanup marker.')
      }
    }
    if (schemaContract(db) !== schemaContract(expected)) {
      throw new Error('Database schema does not match the exact supported current contract.')
    }
    for (const marker of kind === 'accounts' ? [] : ['concept_schema', 'certification_schema']) {
      const rows = db.prepare(`SELECT version FROM ${marker}`).all()
      if (rows.length !== 1 || rows[0]?.version !== 1) {
        throw new Error('Invalid independently versioned schema marker.')
      }
    }
    if (kind === 'personal') {
      const owners = db.prepare('SELECT singleton, account_id FROM private_library_owner').all()
      if (
        options.unbound
          ? owners.length !== 0
          : owners.length !== 1 || owners[0]?.singleton !== 1 || owners[0]?.account_id !== owner
      ) {
        throw new Error('Private database owner mismatch.')
      }
    }
    if (
      db.prepare('PRAGMA integrity_check').get()?.integrity_check !== 'ok' ||
      db.prepare('PRAGMA foreign_key_check').all().length !== 0
    ) {
      throw new Error('Database integrity check failed.')
    }
  } finally {
    expected.close()
    db.close()
  }
}

/** Read Flyway's audit identity; Flyway itself remains responsible for validating checksums. */
function historyContract(db: DatabaseSync): string {
  return JSON.stringify(
    db
      .prepare(
        `
    SELECT installed_rank, version, description, type, script, checksum, success
    FROM flyway_schema_history ORDER BY installed_rank
  `,
      )
      .all(),
  )
}

/** Seal a freshly Flyway-generated empty personal template and its audit identity. */
export function sealTemplate(path: string): void {
  validateCurrent(path, 'personal', undefined, { unbound: true })
  const db = new DatabaseSync(path, { readOnly: true })
  const expected = reference('personal')
  try {
    const tables = expected
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all()
    for (const { name } of tables) {
      const actualRows = db.prepare(`SELECT * FROM "${String(name)}"`).all()
      const expectedRows = expected.prepare(`SELECT * FROM "${String(name)}"`).all()
      if (JSON.stringify(actualRows) !== JSON.stringify(expectedRows)) {
        throw new Error('Template contains content, history or a bound owner.')
      }
    }
    const history = db
      .prepare('SELECT version, type, script, success FROM flyway_schema_history')
      .all()
    if (
      history.length !== 1 ||
      history[0]?.version !== '1' ||
      history[0]?.type !== 'SQL' ||
      history[0]?.script !== 'V1__current_schema.sql' ||
      history[0]?.success !== 1
    ) {
      throw new Error('Template must be generated by Flyway migrate, not baselined.')
    }
    const manifest: TemplateManifest = {
      format: 1,
      image,
      migrationSha256: personalMigrationDigest(),
      databaseSha256: sha256(readFileSync(path)),
      schemaSha256: sha256(schemaContract(db)),
      historySha256: sha256(historyContract(db)),
    }
    writeFileSync(`${path}.manifest.json`, JSON.stringify(manifest, null, 2) + '\n', {
      flag: 'wx',
      mode: 0o600,
    })
    chmodSync(path, 0o600)
  } finally {
    expected.close()
    db.close()
  }
}

/** Refuse a corrupted or stale artifact before cloning; trust requires protecting both files. */
export function verifyTemplate(path: string): void {
  requireFile(path)
  requireFile(`${path}.manifest.json`)
  const manifest = JSON.parse(readFileSync(`${path}.manifest.json`, 'utf8')) as TemplateManifest
  if (
    manifest.format !== 1 ||
    manifest.image !== image ||
    manifest.migrationSha256 !== personalMigrationDigest() ||
    manifest.databaseSha256 !== sha256(readFileSync(path))
  ) {
    throw new Error('Corrupt or stale personal template.')
  }
  validateCurrent(path, 'personal', undefined, { unbound: true })
  const db = new DatabaseSync(path, { readOnly: true })
  try {
    if (
      manifest.schemaSha256 !== sha256(schemaContract(db)) ||
      manifest.historySha256 !== sha256(historyContract(db))
    ) {
      throw new Error('Template schema or Flyway identity mismatch.')
    }
  } finally {
    db.close()
  }
}

/** Flush a completed file before atomic hard-link installation in the same directory. */
function syncFile(path: string): void {
  const descriptor = openSync(path, 'r')
  try {
    fsyncSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
}

/** Clone, bind and atomically install outside requests; never overwrite a concurrent winner.
 * @throws {Error} For unsafe paths, stale templates or an existing target with an unverifiable owner.
 */
export function provisionTemplate(template: string, directory: string, owner: string): string {
  if (!ownerPattern.test(owner)) {
    throw new Error('A canonical internal owner ID is required.')
  }
  rejectLinks(directory)
  if (!existsSync(directory)) {
    mkdirSync(directory, { mode: 0o700 })
  }
  const directoryStat = lstatSync(directory)
  if (!directoryStat.isDirectory() || (directoryStat.mode & 0o777) !== 0o700) {
    throw new Error('Personal directory must have mode 0700.')
  }
  const target = join(directory, `${owner}.sqlite3`)
  if (lstatExists(target)) {
    validateCurrent(target, 'personal', owner)
    chmodSync(target, 0o600)
    return target
  }
  verifyTemplate(template)
  const temporary = join(directory, `.provisioning-${randomUUID()}.sqlite3`)
  try {
    copyFileSync(template, temporary, 1)
    chmodSync(temporary, 0o600)
    const db = new DatabaseSync(temporary)
    try {
      db.prepare('INSERT INTO private_library_owner VALUES (1, ?)').run(owner)
    } finally {
      db.close()
    }
    validateCurrent(temporary, 'personal', owner)
    syncFile(temporary)
    try {
      linkSync(temporary, target)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error
      }
      validateCurrent(target, 'personal', owner)
    }
    syncFile(directory)
    return target
  } finally {
    rmSync(temporary, { force: true })
  }
}

/** Install a fully prepared owner-bound file with the same atomic contract as cloning. */
export function installPrepared(temporary: string, directory: string, owner: string): string {
  rejectLinks(directory)
  if (
    !ownerPattern.test(owner) ||
    dirname(resolve(temporary)) !== resolve(directory) ||
    (lstatSync(directory).mode & 0o777) !== 0o700
  ) {
    throw new Error(
      'Prepared installation requires a canonical owner and the same private directory.',
    )
  }
  validateCurrent(temporary, 'personal', owner)
  chmodSync(temporary, 0o600)
  syncFile(temporary)
  const target = join(directory, `${owner}.sqlite3`)
  try {
    linkSync(temporary, target)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      throw error
    }
    validateCurrent(target, 'personal', owner)
  }
  syncFile(directory)
  return target
}

/** Use SQLite's online backup API so committed WAL pages are included; retain the original. */
export async function consistentBackup(source: string, destination: string): Promise<void> {
  requireFile(source)
  rejectLinks(destination)
  const reserved = openSync(destination, 'wx', 0o600)
  closeSync(reserved)
  const db = new DatabaseSync(source, { readOnly: true })
  try {
    await backup(db, destination)
    chmodSync(destination, 0o600)
    syncFile(destination)
  } finally {
    db.close()
  }
}
