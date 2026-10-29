import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
  appendFileSync,
  chmodSync,
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import {
  consistentBackup,
  image,
  provisionTemplate,
  rejectLinks,
  requireFile,
  sealTemplate,
  sha256,
  sqlRoot,
  validateCurrent,
} from './database-files.ts'
import { migratePrivateStudy } from '../database/tools/legacy/migrate-private-study.ts'
import { finishStudySeparation } from '../database/tools/legacy/study-separation.ts'

export const ownerPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/

type Conversion = {
  accounts: string
  shared: string
  fleet: string
  destination: string
  legacyOwner?: string
}

/** Reject damaged SQLite files before looking at their application contents. */
function integrity(db: DatabaseSync): void {
  if (
    db.prepare('PRAGMA integrity_check').get()?.integrity_check !== 'ok' ||
    db.prepare('PRAGMA foreign_key_check').all().length
  ) {
    throw new Error('Database integrity failed.')
  }
}

/** Inspect legacy inputs read-only. No output, database repair or implicit creation occurs here.
 * @throws {Error} For unsupported identities, unsafe paths or unverifiable history ownership.
 */
export function preflight(options: Conversion): { accounts: string[]; privateFiles: string[] } {
  for (const path of [options.accounts, options.shared, options.fleet, options.destination]) {
    if (path) {
      rejectLinks(path)
    }
  }
  if (existsSync(options.destination)) {
    throw new Error('Destination already exists.')
  }
  const ids: string[] = []
  for (const [path, identity, versions] of [
    [options.accounts, 1096242005, [1, 2]],
    [options.shared, 1096242004, [1, 2, 3, 4]],
  ] as const) {
    requireFile(path)
    const db = new DatabaseSync(path, { readOnly: true })
    try {
      integrity(db)
      if (
        db.prepare('PRAGMA application_id').get()?.application_id !== identity ||
        !(versions as readonly unknown[]).includes(
          db.prepare('PRAGMA user_version').get()?.user_version,
        )
      ) {
        throw new Error('Unsupported legacy format.')
      }
      if (
        path === options.shared &&
        db.prepare("SELECT name FROM sqlite_master WHERE name = 'private_library_owner'").get()
      ) {
        throw new Error('A private database cannot be the shared input.')
      }
      if (path === options.accounts) {
        for (const row of db.prepare('SELECT id FROM accounts').all()) {
          if (!ownerPattern.test(String(row.id))) {
            throw new Error('Noncanonical account ID.')
          }
          ids.push(String(row.id))
        }
      } else {
        for (const table of ['quiz_sessions', 'quiz_mastery', 'earned_certifications']) {
          const columns = db.prepare(`PRAGMA table_info(${table})`).all()
          if (!columns.length) {
            continue
          }
          const version = Number(db.prepare('PRAGMA user_version').get()?.user_version)
          const owned = columns.some((column) => column.name === 'account_id')
          if ((version <= 2 && owned) || (version >= 3 && !owned)) {
            throw new Error('Legacy version does not match study ownership schema.')
          }

          const occupied = Number(db.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n)
          if (
            occupied &&
            !columns.some((column) => column.name === 'account_id') &&
            !ids.includes(options.legacyOwner ?? '')
          ) {
            throw new Error(
              'Occupied preowner history requires an explicit verified account owner.',
            )
          }
          if (columns.some((column) => column.name === 'account_id')) {
            for (const row of db.prepare(`SELECT DISTINCT account_id FROM ${table}`).all()) {
              if (!ids.includes(String(row.account_id))) {
                throw new Error('Unknown study owner.')
              }
            }
          }
        }
      }
    } finally {
      db.close()
    }
  }
  rejectLinks(options.fleet)
  if (
    !lstatSync(options.fleet).isDirectory() ||
    (lstatSync(options.fleet).mode & 0o777) !== 0o700
  ) {
    throw new Error('Fleet directory required.')
  }
  const privateFiles = readdirSync(options.fleet)
    .sort()
    .map((name) => {
      const owner = name.replace(/\.sqlite3$/, '')
      if (name !== `${owner}.sqlite3` || !ids.includes(owner)) {
        throw new Error('Unexpected or unowned private fleet entry.')
      }
      const path = join(options.fleet, name)
      requireFile(path)
      const db = new DatabaseSync(path, { readOnly: true })
      try {
        integrity(db)
        if (
          db.prepare('PRAGMA application_id').get()?.application_id !== 1096242004 ||
          db.prepare('PRAGMA user_version').get()?.user_version !== 4 ||
          db.prepare('SELECT account_id FROM private_library_owner WHERE singleton = 1').get()
            ?.account_id !== owner
        ) {
          throw new Error('Private format or owner mismatch.')
        }
      } finally {
        db.close()
      }
      return path
    })
  return { accounts: ids, privateFiles }
}

/** Run only the pinned local standalone Flyway, with no network and a single explicit writable root. */
export function flyway(root: string, path: string, kind: 'central' | 'personal'): void {
  rejectLinks(root)
  rejectLinks(path)
  const local = relative(resolve(root), resolve(path))
  if (!local || local.startsWith('..') || /[:,\n]/.test(root + local)) {
    throw new Error('Unsafe Flyway mount path.')
  }
  const log = openSync(join(root, `flyway-${randomUUID()}.log`), 'wx', 0o600)
  try {
    const result = spawnSync(
      'docker',
      [
        'run',
        '--rm',
        '--pull',
        'never',
        '--network',
        'none',
        '--platform',
        'linux/amd64',
        '--user',
        `${process.getuid!()}:${process.getgid!()}`,
        '--cap-drop',
        'ALL',
        '--security-opt',
        'no-new-privileges',
        '--mount',
        `type=bind,src=${resolve(root)},dst=/work`,
        '--mount',
        `type=bind,src=${sqlRoot},dst=/sql,readonly`,
        image,
        '-configFiles=/sql/flyway.conf',
        `-locations=filesystem:/sql/migrations/${kind}`,
        `-url=jdbc:sqlite:/work/${local}`,
        'migrate',
        'validate',
      ],
      { stdio: ['ignore', log, log] },
    )
    if (result.error || result.status !== 0) {
      throw new Error(`Flyway failed; see restricted logs in ${root}.`)
    }
    chmodSync(path, 0o600)
  } finally {
    closeSync(log)
  }
}

/** Flush durable control-plane records; gate removal is the final publication action. */
function sync(path: string): void {
  const fd = openSync(path, 'r')
  try {
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}

/** Copy application rows into Flyway-created tables, retaining exact IDs and SQL constraints.
 * Missing legacy owner/role columns have explicit conversion rules; unknown columns fail closed.
 */
function importRows(source: string, target: string, legacyOwner?: string): void {
  const input = new DatabaseSync(source, { readOnly: true })
  const output = new DatabaseSync(target)
  try {
    output.exec('PRAGMA foreign_keys = ON; BEGIN IMMEDIATE')
    const tables = input
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all()
    const priority = [
      'accounts',
      'sessions',
      'sources',
      'questions',
      'quiz_sessions',
      'quiz_evidence',
    ]
    tables.sort((a, b) => priority.indexOf(String(a.name)) - priority.indexOf(String(b.name)))
    for (const { name } of tables) {
      const table = String(name)
      if (
        ['flyway_schema_history', 'private_study_separation', 'private_library_owner'].includes(
          table,
        )
      ) {
        continue
      }
      if (
        !/^[a-z_]+$/.test(table) ||
        !output
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
          .get(table)
      ) {
        throw new Error(`Unsupported legacy table: ${table}`)
      }
      const columns = input
        .prepare(`PRAGMA table_info(${table})`)
        .all()
        .map((row) => String(row.name))
      const targetColumns = output
        .prepare(`PRAGMA table_info(${table})`)
        .all()
        .map((row) => String(row.name))
      if (columns.some((column) => !targetColumns.includes(column))) {
        throw new Error('Unsupported legacy columns.')
      }
      const needsOwner = targetColumns.includes('account_id') && !columns.includes('account_id')
      const rows = input.prepare(`SELECT * FROM ${table}`).all()
      output.exec(`DELETE FROM ${table}`)
      for (const row of rows) {
        if (needsOwner) {
          if (!legacyOwner) {
            throw new Error('Explicit legacy owner required.')
          }
          row.account_id = legacyOwner
        }
        if (
          row.account_id !== undefined &&
          legacyOwner &&
          row.account_id !== legacyOwner &&
          output
            .prepare("SELECT name FROM sqlite_master WHERE name = 'private_library_owner'")
            .get()
        ) {
          throw new Error('Private rows belong to another owner.')
        }
        const names = Object.keys(row)
        output
          .prepare(
            `INSERT INTO ${table} (${names.join(',')}) VALUES (${names.map(() => '?').join(',')})`,
          )
          .run(...Object.values(row))
      }
      if (Number(output.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n) !== rows.length) {
        throw new Error('Imported row count mismatch.')
      }
      if (rows.length) {
        const names = Object.keys(rows[0]!)
        const actual = output.prepare(`SELECT ${names.join(',')} FROM ${table}`).all()

        const stableRows = (values: typeof rows): string =>
          JSON.stringify(values.map((row) => JSON.stringify(names.map((name) => row[name]))).sort())

        if (stableRows(actual) !== stableRows(rows)) {
          throw new Error('Imported data mismatch.')
        }
      }
    }
    if (input.prepare("SELECT name FROM sqlite_master WHERE name = 'sqlite_sequence'").get()) {
      for (const row of input.prepare('SELECT name, seq FROM sqlite_sequence').all()) {
        output.prepare('DELETE FROM sqlite_sequence WHERE name = ?').run(row.name!)
        output
          .prepare('INSERT INTO sqlite_sequence(name, seq) VALUES (?, ?)')
          .run(row.name!, row.seq!)
      }
    }
    integrity(output)
    output.exec('COMMIT')
  } catch (error) {
    output.exec('ROLLBACK')
    throw error
  } finally {
    input.close()
    output.close()
  }
}

/** Convert only consistent snapshots into an entirely new gated deployment directory.
 * @throws {Error} Any failure retains RESTART_BLOCKED and all backups; abandon output and retry elsewhere.
 * The operator must stop all old writers externally: an acknowledgment is not a process lock.
 */
export async function convert(options: Conversion, offline: boolean): Promise<void> {
  if (!offline) {
    throw new Error('Stop/drain all writers and acknowledge --offline.')
  }
  const plan = preflight(options)
  mkdirSync(options.destination, { mode: 0o700 })
  const root = options.destination
  const gate = join(root, 'RESTART_BLOCKED')
  writeFileSync(gate, 'Incomplete conversion. Do not start any server.\n', {
    flag: 'wx',
    mode: 0o600,
  })
  sync(gate)
  sync(root)
  const lock = openSync(join(root, 'maintenance.lock'), 'wx', 0o600)
  const journal = join(root, 'maintenance.jsonl')

  const record = (value: object): void => {
    appendFileSync(journal, JSON.stringify(value) + '\n', { mode: 0o600 })
    sync(journal)
  }

  try {
    const backups = join(root, 'backups')
    const fleet = join(root, 'users')
    mkdirSync(backups, { mode: 0o700 })
    mkdirSync(fleet, { mode: 0o700 })
    const inputs = [options.accounts, options.shared, ...plan.privateFiles]
    const snapshots: string[] = []
    for (const [index, source] of inputs.entries()) {
      const snapshot = join(backups, `${index}.sqlite3`)
      await consistentBackup(source, snapshot)
      const db = new DatabaseSync(snapshot, { readOnly: true })
      try {
        integrity(db)
      } finally {
        db.close()
      }
      snapshots.push(snapshot)
      record({
        status: 'backup-verified',
        source,
        snapshot,
        sha256: sha256(readFileSync(snapshot)),
      })
    }
    // Existing managed private files retain a verifiable audit trail before adoption.
    for (const snapshot of snapshots.slice(2)) {
      const db = new DatabaseSync(snapshot, { readOnly: true })
      let managed: boolean
      try {
        managed = !!db
          .prepare("SELECT name FROM sqlite_master WHERE name = 'flyway_schema_history'")
          .get()
      } finally {
        db.close()
      }
      if (managed) {
        const auditCopy = join(root, `.audit-${randomUUID()}.sqlite3`)
        copyFileSync(snapshot, auditCopy, 1)
        try {
          flyway(root, auditCopy, 'personal')
        } finally {
          rmSync(auditCopy, { force: true })
        }
      }
    }
    const central = join(root, 'central.sqlite3')
    const template = join(root, 'personal-template.sqlite3')
    flyway(root, central, 'central')
    flyway(root, template, 'personal')
    sealTemplate(template)
    importRows(snapshots[0]!, central)
    importRows(snapshots[1]!, central, options.legacyOwner)
    for (const owner of plan.accounts) {
      const target = provisionTemplate(template, fleet, owner)
      const index = plan.privateFiles.findIndex((path) => path.endsWith(`/${owner}.sqlite3`))
      if (index >= 0) {
        importRows(snapshots[index + 2]!, target, owner)
      }
      const db = new DatabaseSync(central)
      try {
        migratePrivateStudy(db, target, owner)
      } finally {
        db.close()
      }
      validateCurrent(target, 'personal', owner)
      flyway(root, target, 'personal')
      sync(target)
      record({ status: 'owner-validated', owner, sha256: sha256(readFileSync(target)) })
    }
    const db = new DatabaseSync(central)
    try {
      finishStudySeparation(db)
    } finally {
      db.close()
    }
    validateCurrent(central, 'central')
    flyway(root, central, 'central')
    sync(central)
    sync(fleet)
    record({ status: 'fleet-success', owners: plan.accounts.length })
    writeFileSync(join(root, 'READY'), '1\n', { flag: 'wx', mode: 0o600 })
    sync(join(root, 'READY'))
    sync(root)
    rmSync(gate)
    sync(root)
  } catch (error) {
    record({ status: 'failed', restartBlocked: true })
    throw error
  } finally {
    closeSync(lock)
    rmSync(join(root, 'maintenance.lock'))
    sync(root)
  }
}

/** Provision only a centrally registered account outside ordinary application requests. */
export function provision(
  central: string,
  template: string,
  directory: string,
  owner: string,
): string {
  validateCurrent(central, 'central')
  if (existsSync(join(dirname(central), 'RESTART_BLOCKED'))) {
    throw new Error('Maintenance gate active.')
  }
  if (readFileSync(join(dirname(central), 'READY'), 'utf8') !== '1\n') {
    throw new Error('Deployment is not ready.')
  }
  const db = new DatabaseSync(central, { readOnly: true })
  try {
    if (!db.prepare('SELECT id FROM accounts WHERE id = ?').get(owner)) {
      throw new Error('Unknown account.')
    }
  } finally {
    db.close()
  }
  return provisionTemplate(template, directory, owner)
}

/** Generate a fresh immutable template outside requests using actual Flyway. */
export function generateTemplate(root: string): string {
  rejectLinks(root)
  if (!lstatSync(root).isDirectory() || (lstatSync(root).mode & 0o777) !== 0o700) {
    throw new Error('Template workspace must be a real 0700 directory.')
  }
  const path = join(root, 'personal-template.sqlite3')
  if (existsSync(path) || existsSync(`${path}.manifest.json`)) {
    throw new Error('Template already exists.')
  }
  flyway(root, path, 'personal')
  sealTemplate(path)
  return path
}

/** Maintain the current fleet offline; never clear a preexisting failure gate automatically.
 * @throws {Error} Failed maintenance leaves the gate and durable prior success records intact.
 */
export async function maintain(root: string, offline: boolean): Promise<void> {
  if (!offline) {
    throw new Error('Stop/drain writers and acknowledge --offline.')
  }
  rejectLinks(root)
  const gate = join(root, 'RESTART_BLOCKED')
  const lockPath = join(root, 'maintenance.lock')
  rejectLinks(gate)
  rejectLinks(lockPath)
  if (existsSync(gate)) {
    throw new Error('Prior failure requires operator recovery.')
  }
  const lock = openSync(lockPath, 'wx', 0o600)
  try {
    writeFileSync(gate, 'Maintenance incomplete. Do not restart.\n', { flag: 'wx', mode: 0o600 })
    sync(gate)
    sync(root)
    const central = join(root, 'central.sqlite3')
    const db = new DatabaseSync(central, { readOnly: true })
    let owners: string[]
    try {
      owners = db
        .prepare('SELECT id FROM accounts')
        .all()
        .map((row) => String(row.id))
    } finally {
      db.close()
    }
    const entries: { path: string; kind: 'central' | 'personal'; owner?: string }[] = [
      {
        path: central,
        kind: 'central' as 'central' | 'personal',
        owner: undefined as string | undefined,
      },
    ]
    for (const name of readdirSync(join(root, 'users')).sort()) {
      const owner = name.replace(/\.sqlite3$/, '')
      if (!ownerPattern.test(owner) || !owners.includes(owner) || name !== `${owner}.sqlite3`) {
        throw new Error('Unexpected personal fleet entry.')
      }
      entries.push({ path: join(root, 'users', name), kind: 'personal', owner })
    }
    for (const entry of entries) {
      validateCurrent(entry.path, entry.kind, entry.owner)
    }
    const backups = join(root, `maintenance-backups-${randomUUID()}`)
    mkdirSync(backups, { mode: 0o700 })
    const journal = join(root, 'maintenance.jsonl')
    rejectLinks(journal)
    for (const [index, entry] of entries.entries()) {
      const saved = join(backups, `${index}.sqlite3`)
      await consistentBackup(entry.path, saved)
      validateCurrent(saved, entry.kind, entry.owner)
      appendFileSync(
        journal,
        JSON.stringify({
          status: 'backup-verified',
          file: entry.path,
          saved,
          sha256: sha256(readFileSync(saved)),
        }) + '\n',
        { mode: 0o600 },
      )
      sync(journal)
      flyway(root, entry.path, entry.kind)
      validateCurrent(entry.path, entry.kind, entry.owner)
      sync(entry.path)
      appendFileSync(journal, JSON.stringify({ status: 'success', file: entry.path }) + '\n', {
        mode: 0o600,
      })
      sync(journal)
    }
    sync(root)
    rmSync(gate)
    sync(root)
  } finally {
    closeSync(lock)
    rmSync(lockPath)
    sync(root)
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, config, flag] = process.argv.slice(2)
  if (!config) {
    throw new Error('Usage: database-admin.ts preflight|convert config.json [--offline]')
  }
  if (command === 'maintain') {
    await maintain(config, flag === '--offline')
  } else if (command === 'template') {
    console.log(generateTemplate(config))
  } else if (command === 'provision' || command === 'provision-pending') {
    const options = JSON.parse(readFileSync(config, 'utf8')) as {
      central: string
      template: string
      directory: string
      owner: string
    }
    if (command === 'provision') {
      console.log(provision(options.central, options.template, options.directory, options.owner))
    } else {
      validateCurrent(options.central, 'central')
      const central = new DatabaseSync(options.central, { readOnly: true })
      let owners: string[]
      try {
        owners = central
          .prepare('SELECT id FROM accounts ORDER BY id')
          .all()
          .map((row) => String(row.id))
      } finally {
        central.close()
      }
      for (const owner of owners) {
        provision(options.central, options.template, options.directory, owner)
      }
    }
  } else {
    const options = JSON.parse(readFileSync(config, 'utf8')) as Conversion
    if (command === 'preflight') {
      console.log(JSON.stringify(preflight(options), null, 2))
    } else if (command === 'convert') {
      await convert(options, flag === '--offline')
    } else {
      throw new Error('Unknown administration command.')
    }
  }
}
