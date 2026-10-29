import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
  appendFileSync,
  closeSync,
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir, cpus, release, totalmem } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { performance } from 'node:perf_hooks'
import {
  consistentBackup,
  image,
  installPrepared,
  provisionTemplate,
  rejectLinks,
  sealTemplate,
  sha256,
  sqlRoot,
  validateCurrent,
  verifyTemplate,
} from './flyway-files.ts'
import type { DatabaseKind } from './flyway-files.ts'

const ownerPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.sqlite3$/

type Entry = { path: string; kind: DatabaseKind; owner?: string }

type Measurement = { operation: string; milliseconds: number; bytes?: number; count?: number }

/** Confine every writable mount to a private, disposable prototype workspace. */
export function createWorkspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'study-flyway-prototype-'))
  writeFileSync(join(root, 'PROTOTYPE_ONLY'), 'synthetic databases only\n', { mode: 0o600 })
  return root
}

/** Require the scratch marker, private permissions and a real directory before mounting it. */
function requireWorkspace(root: string): void {
  rejectLinks(root)
  const stat = lstatSync(root)
  if (
    dirname(root) !== resolve(tmpdir()) ||
    !root.split('/').at(-1)?.startsWith('study-flyway-prototype-') ||
    !stat.isDirectory() ||
    (stat.mode & 0o777) !== 0o700 ||
    readFileSync(join(root, 'PROTOTYPE_ONLY'), 'utf8') !== 'synthetic databases only\n'
  ) {
    throw new Error('Only private synthetic prototype workspaces are supported.')
  }
}

/** Start one isolated CLI process, including Docker/JVM startup in the elapsed measurement. */
export async function flyway(
  root: string,
  path: string,
  kind: DatabaseKind,
  commands: ('migrate' | 'validate' | 'baseline' | 'info')[],
  next?: 'good' | 'failure',
  owner?: string,
): Promise<number> {
  requireWorkspace(root)
  rejectLinks(path)
  const local = relative(root, resolve(path))
  if (local.startsWith('..') || local === '' || local.includes(':')) {
    throw new Error('Database must be inside the prototype workspace.')
  }
  if (commands.includes('baseline')) {
    validateCurrent(path, kind, owner, { next: hasProbe(path) })
  }
  const locations = [`filesystem:/sql/${kind}`]
  if (next === 'good') {
    locations.push('filesystem:/sql/synthetic-next')
  } else if (next === 'failure') {
    locations.push('filesystem:/work/failure-sql')
  }
  const logs = join(root, 'logs')
  rejectLinks(logs)
  mkdirSync(logs, { recursive: true, mode: 0o700 })
  const output = openSync(join(logs, `${randomUUID()}.log`), 'wx', 0o600)
  const args = [
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
    `type=bind,src=${root},dst=/work`,
    '--mount',
    `type=bind,src=${sqlRoot},dst=/sql,readonly`,
    image,
    '-configFiles=/sql/flyway.conf',
    `-locations=${locations.join(',')}`,
    `-url=jdbc:sqlite:/work/${local}`,
    ...commands,
  ]
  const started = performance.now()
  try {
    await new Promise<void>((resolveRun, rejectRun) => {
      const child = spawn('docker', args, { stdio: ['ignore', output, output] })
      child.once('error', rejectRun)
      child.once('exit', (code, signal) => {
        if (code === 0) {
          resolveRun()
        } else {
          rejectRun(
            new Error(`Flyway failed (${code ?? signal}); inspect restricted logs in ${logs}.`),
          )
        }
      })
    })
    if (existsSync(path)) {
      chmodSync(path, 0o600)
    }
    return performance.now() - started
  } finally {
    closeSync(output)
  }
}

/** Flyway creates the template; local tooling only verifies and seals the result. */
export async function generateTemplate(root: string, name = 'template.sqlite3'): Promise<string> {
  const path = join(root, name)
  if (existsSync(path)) {
    throw new Error('Template output already exists.')
  }
  await flyway(root, path, 'personal', ['migrate', 'validate'])
  sealTemplate(path)
  return path
}

/** Enumerate canonical personal files and refuse unexpected database-shaped filenames or links. */
function fleetEntries(root: string): Entry[] {
  const directory = join(root, 'fleet')
  rejectLinks(directory)
  if (!lstatSync(directory).isDirectory() || (lstatSync(directory).mode & 0o777) !== 0o700) {
    throw new Error('Personal fleet directory must have mode 0700.')
  }
  const entries: Entry[] = [
    { path: join(root, 'accounts.sqlite3'), kind: 'accounts' },
    { path: join(root, 'shared.sqlite3'), kind: 'shared' },
  ]
  for (const name of readdirSync(directory).sort()) {
    if (!ownerPattern.test(name)) {
      throw new Error('Unexpected file in the personal fleet directory.')
    }
    const path = join(directory, name)
    rejectLinks(path)
    entries.push({ path, kind: 'personal', owner: name.slice(0, -'.sqlite3'.length) })
  }
  return entries
}

/** Detect only the disposable experiment's expected schema extension, not a migration version. */
function hasProbe(path: string): boolean {
  const db = new DatabaseSync(path, { readOnly: true })
  try {
    return !!db
      .prepare("SELECT name FROM sqlite_master WHERE name = 'prototype_upgrade_probe'")
      .get()
  } finally {
    db.close()
  }
}

/** Assert that maintenance never changes authoritative or derived application rows. */
function dataFingerprint(path: string): string {
  const db = new DatabaseSync(path, { readOnly: true })
  try {
    const tables = db
      .prepare(
        `
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
        AND name NOT IN ('flyway_schema_history', 'prototype_upgrade_probe')
      ORDER BY name
    `,
      )
      .all()
    return sha256(
      JSON.stringify(
        tables.map(({ name }) => ({
          name,
          rows: db.prepare(`SELECT * FROM "${String(name).replaceAll('"', '""')}"`).all(),
        })),
      ),
    )
  } finally {
    db.close()
  }
}

/** Maintain a stopped synthetic fleet sequentially, retaining backups and a fail-closed restart gate.
 * @throws {Error} For missing offline acknowledgement or any failed database operation.
 * This is not a cross-file transaction; earlier successes remain upgraded after a later failure.
 */
export async function maintainFleet(
  root: string,
  offline: boolean,
  next?: 'good' | 'failure',
): Promise<Measurement[]> {
  requireWorkspace(root)
  if (!offline) {
    throw new Error(
      'Stop and drain the application first; explicit offline acknowledgement required.',
    )
  }
  const lock = join(root, 'maintenance.lock')
  const descriptor = openSync(lock, 'wx', 0o600)
  const journal = join(root, 'maintenance.jsonl')
  const gate = join(root, 'RESTART_BLOCKED')
  const measurements: Measurement[] = []
  try {
    rejectLinks(gate)
    rejectLinks(journal)
    writeFileSync(gate, 'Maintenance incomplete. Do not restart.\n', { mode: 0o600 })
    const entries = fleetEntries(root)
    // Preflight the entire fleet before the first backup or Flyway write.
    for (const entry of entries) {
      validateCurrent(entry.path, entry.kind, entry.owner, { next: hasProbe(entry.path) })
    }
    const backups = join(root, `backups-${randomUUID()}`)
    mkdirSync(backups, { mode: 0o700 })
    for (const entry of entries) {
      const label = relative(root, entry.path)
      try {
        const before = dataFingerprint(entry.path)
        const saved = join(backups, `${entry.kind}-${entry.owner ?? 'central'}.sqlite3`)
        const started = performance.now()
        await consistentBackup(entry.path, saved)
        validateCurrent(saved, entry.kind, entry.owner, { next: hasProbe(saved) })
        measurements.push({
          operation: 'backup',
          milliseconds: performance.now() - started,
          bytes: statSync(saved).size,
        })
        appendFileSync(
          journal,
          JSON.stringify({
            database: label,
            status: 'backup-verified',
            backup: relative(root, saved),
            backupSha256: sha256(readFileSync(saved)),
          }) + '\n',
          { mode: 0o600 },
        )
        const db = new DatabaseSync(entry.path, { readOnly: true })
        let adopted: boolean
        try {
          adopted = !!db
            .prepare("SELECT name FROM sqlite_master WHERE name = 'flyway_schema_history'")
            .get()
        } finally {
          db.close()
        }
        // Central databases succeed first in the deliberate personal-failure experiment.
        const effectiveNext = next === 'failure' && entry.kind !== 'personal' ? 'good' : next
        const commands: ('baseline' | 'validate' | 'migrate')[] = [
          'validate',
          'migrate',
          'validate',
        ]
        if (!adopted) {
          // Current-schema validation above precedes every baseline history write.
          commands.unshift('baseline')
        }
        const elapsed = await flyway(
          root,
          entry.path,
          entry.kind,
          commands,
          effectiveNext,
          entry.owner,
        )
        validateCurrent(entry.path, entry.kind, entry.owner, {
          next: effectiveNext === 'good' || hasProbe(entry.path),
        })
        if (dataFingerprint(entry.path) !== before) {
          throw new Error('Application rows changed during maintenance.')
        }
        measurements.push({ operation: 'flyway-maintenance', milliseconds: elapsed })
        appendFileSync(
          journal,
          JSON.stringify({
            database: label,
            status: 'success',
            backup: relative(root, saved),
            backupSha256: sha256(readFileSync(saved)),
          }) + '\n',
          { mode: 0o600 },
        )
      } catch (error) {
        appendFileSync(
          journal,
          JSON.stringify({
            database: label,
            status: 'failure',
            message: 'See restricted Flyway logs; restart remains blocked.',
          }) + '\n',
          { mode: 0o600 },
        )
        throw error
      }
    }
    appendFileSync(
      journal,
      JSON.stringify({ status: 'fleet-success', databases: entries.length }) + '\n',
      { mode: 0o600 },
    )
    rmSync(gate)
    return measurements
  } catch (error) {
    rejectLinks(journal)
    appendFileSync(
      journal,
      JSON.stringify({ status: 'fleet-failure', restartBlocked: true }) + '\n',
      { mode: 0o600 },
    )
    throw error
  } finally {
    closeSync(descriptor)
    rmSync(lock)
  }
}

/** Seed synthetic current-schema fixtures without involving production startup or personal content. */
function seedCurrent(path: string, kind: DatabaseKind, owner?: string): void {
  const db = new DatabaseSync(path)
  try {
    db.exec(readFileSync(join(sqlRoot, kind, 'V1__current_schema.sql'), 'utf8'))
    if (kind === 'accounts') {
      db.prepare('INSERT INTO accounts VALUES (?, ?, ?, ?)').run(
        'fixture-account',
        'https://issuer.invalid',
        'synthetic',
        'Synthetic fixture',
      )
      db.prepare('INSERT INTO sessions VALUES (?, ?, ?, ?)').run(
        'not-a-real-token-hash',
        'fixture-account',
        1,
        'student',
      )
    } else if (kind === 'shared') {
      db.exec(
        "INSERT INTO sources VALUES (1, 'prototype', 'synthetic', 'Synthetic', 'fixture', 'Synthetic fixture', 'curated', '{}')",
      )
      const insert = db.prepare(
        'INSERT INTO questions(source_id, reference, data, fingerprint, answer_key) VALUES (1, ?, ?, ?, ?)',
      )
      for (let index = 0; index < 100; index++) {
        insert.run(
          `fixture-${index}`,
          JSON.stringify({ synthetic: true, index }),
          `fingerprint-${index}`,
          '[]',
        )
      }
    }
    if (owner) {
      db.prepare('INSERT INTO private_library_owner VALUES (1, ?)').run(owner)
      const attempt = db.prepare('INSERT INTO quiz_sessions VALUES (?, ?, ?, ?, ?)')
      const evidence = db.prepare('INSERT INTO quiz_evidence VALUES (?, ?, ?, ?, ?, ?, ?)')
      for (let index = 0; index < 25; index++) {
        const id = `synthetic-attempt-${index}`
        attempt.run(owner, id, 'complete', index, JSON.stringify({ synthetic: true, index }))
        evidence.run(owner, id, 1, 'prototype', 'synthetic', '{}', 'synthetic-checksum')
      }
    }
  } finally {
    db.close()
  }
}

/** Exercise real Flyway refusals and transactional retry without clean or repair. */
async function negativeControls(root: string, template: string): Promise<string[]> {
  const passed: string[] = []
  const corrupt = join(root, 'corrupt.sqlite3')
  copyFileSync(template, corrupt)
  copyFileSync(`${template}.manifest.json`, `${corrupt}.manifest.json`)
  appendFileSync(corrupt, 'corrupt')
  try {
    verifyTemplate(corrupt)
    throw new Error('Corrupt template was accepted.')
  } catch (error) {
    if (!(error instanceof Error) || !/Corrupt or stale/.test(error.message)) {
      throw error
    }
    passed.push('corrupt-template-refused')
  }
  const stale = join(root, 'stale.sqlite3')
  copyFileSync(template, stale)
  const manifest = JSON.parse(readFileSync(`${template}.manifest.json`, 'utf8'))
  manifest.migrationSha256 = 'stale'
  writeFileSync(`${stale}.manifest.json`, JSON.stringify(manifest), { mode: 0o600 })
  try {
    verifyTemplate(stale)
    throw new Error('Stale template was accepted.')
  } catch (error) {
    if (!(error instanceof Error) || !/Corrupt or stale/.test(error.message)) {
      throw error
    }
    passed.push('stale-template-refused')
  }
  const path = join(root, 'retry.sqlite3')
  copyFileSync(template, path)
  const failure = join(root, 'failure-sql')
  mkdirSync(failure, { mode: 0o700 })
  writeFileSync(
    join(failure, 'V2__prototype_probe.sql'),
    'CREATE TABLE partial_write (id INTEGER);\nINSERT INTO absent_table VALUES (1);\n',
    { mode: 0o600 },
  )
  let refused = false
  try {
    await flyway(root, path, 'personal', ['migrate'], 'failure')
  } catch {
    refused = true
  }
  if (!refused) {
    throw new Error('Failure migration unexpectedly succeeded.')
  }
  const failed = new DatabaseSync(path, { readOnly: true })
  try {
    if (
      failed.prepare("SELECT name FROM sqlite_master WHERE name = 'partial_write'").get() ||
      failed.prepare("SELECT version FROM flyway_schema_history WHERE version = '2'").get()
    ) {
      throw new Error('Flyway did not roll back schema and history together.')
    }
  } finally {
    failed.close()
  }
  await flyway(root, path, 'personal', ['migrate', 'validate'], 'good')
  passed.push('migration-failure-rolled-back-and-retry-succeeded')
  const tampered = new DatabaseSync(path)
  tampered.exec("UPDATE flyway_schema_history SET checksum = checksum + 1 WHERE version = '2'")
  tampered.close()
  refused = false
  try {
    await flyway(root, path, 'personal', ['validate'], 'good')
  } catch {
    refused = true
  }
  if (!refused) {
    throw new Error('Flyway accepted a changed checksum.')
  }
  passed.push('flyway-checksum-mismatch-refused')
  const unknown = join(root, 'unknown-history.sqlite3')
  copyFileSync(template, unknown)
  const unknownDb = new DatabaseSync(unknown)
  unknownDb.exec("UPDATE flyway_schema_history SET version = '999' WHERE version = '1'")
  unknownDb.close()
  refused = false
  try {
    await flyway(root, unknown, 'personal', ['validate'])
  } catch {
    refused = true
  }
  if (!refused) {
    throw new Error('Flyway accepted unknown applied history.')
  }
  passed.push('flyway-unknown-applied-version-refused')
  const fleet = createWorkspace()
  mkdirSync(join(fleet, 'fleet'), { mode: 0o700 })
  seedCurrent(join(fleet, 'accounts.sqlite3'), 'accounts')
  seedCurrent(join(fleet, 'shared.sqlite3'), 'shared')
  const owner = randomUUID()
  seedCurrent(join(fleet, 'fleet', `${owner}.sqlite3`), 'personal', owner)
  await maintainFleet(fleet, true)
  mkdirSync(join(fleet, 'failure-sql'), { mode: 0o700 })
  copyFileSync(
    join(failure, 'V2__prototype_probe.sql'),
    join(fleet, 'failure-sql', 'V2__prototype_probe.sql'),
  )
  refused = false
  try {
    await maintainFleet(fleet, true, 'failure')
  } catch {
    refused = true
  }
  if (
    !refused ||
    !existsSync(join(fleet, 'RESTART_BLOCKED')) ||
    !hasProbe(join(fleet, 'accounts.sqlite3')) ||
    hasProbe(join(fleet, 'fleet', `${owner}.sqlite3`))
  ) {
    throw new Error('Fleet partial failure did not retain the restart gate and earlier success.')
  }
  await maintainFleet(fleet, true, 'good')
  if (existsSync(join(fleet, 'RESTART_BLOCKED'))) {
    throw new Error('Successful fleet retry did not clear the restart gate.')
  }
  passed.push('partial-fleet-failure-gated-and-retry-succeeded')
  appendFileSync(join(root, 'fleet-workspaces.txt'), `${fleet}\n`, { mode: 0o600 })
  return passed
}

/** Measure three independent samples with startup included and no production integration. */
export async function experiment(): Promise<string> {
  const root = createWorkspace()
  const measurements: Measurement[] = []
  const started = performance.now()
  const template = await generateTemplate(root)
  measurements.push({
    operation: 'template-generation-first-container',
    milliseconds: performance.now() - started,
    bytes: statSync(template).size,
  })
  const controls = await negativeControls(root, template)
  for (let sample = 0; sample < 3; sample++) {
    const freshStart = performance.now()
    const freshDirectory = join(root, `fresh-${sample}`)
    mkdirSync(freshDirectory, { mode: 0o700 })
    const fresh = join(freshDirectory, '.initializing.sqlite3')
    await flyway(root, fresh, 'personal', ['migrate', 'validate'])
    const freshDb = new DatabaseSync(fresh)
    const owner = randomUUID()
    freshDb.prepare('INSERT INTO private_library_owner VALUES (1, ?)').run(owner)
    freshDb.close()
    const installed = installPrepared(fresh, freshDirectory, owner)
    rmSync(fresh)
    measurements.push({
      operation: 'fresh-flyway-bind-install',
      milliseconds: performance.now() - freshStart,
    })
    const directory = join(root, `clone-${sample}`)
    const cloneStart = performance.now()
    provisionTemplate(template, directory, owner)
    measurements.push({
      operation: 'template-clone-bind-install',
      milliseconds: performance.now() - cloneStart,
    })
    measurements.push({
      operation: 'noop-flyway-validate',
      milliseconds: await flyway(root, installed, 'personal', ['validate']),
    })
    for (const count of [1, 10]) {
      const fleetRoot = createWorkspace()
      mkdirSync(join(fleetRoot, 'fleet'), { mode: 0o700 })
      seedCurrent(join(fleetRoot, 'accounts.sqlite3'), 'accounts')
      seedCurrent(join(fleetRoot, 'shared.sqlite3'), 'shared')
      for (let index = 0; index < count; index++) {
        const id = randomUUID()
        seedCurrent(join(fleetRoot, 'fleet', `${id}.sqlite3`), 'personal', id)
      }
      const adoption = performance.now()
      const adoptionMetrics = await maintainFleet(fleetRoot, true)
      measurements.push({
        operation: 'fleet-current-adoption',
        count,
        milliseconds: performance.now() - adoption,
      })
      measurements.push(...adoptionMetrics.map((metric) => ({ ...metric, count })))
      const upgrade = performance.now()
      const upgradeMetrics = await maintainFleet(fleetRoot, true, 'good')
      measurements.push({
        operation: 'fleet-next-upgrade',
        count,
        milliseconds: performance.now() - upgrade,
      })
      measurements.push(...upgradeMetrics.map((metric) => ({ ...metric, count })))
      writeFileSync(
        join(fleetRoot, 'measurements.json'),
        JSON.stringify({ sample, count, adoptionMetrics, upgradeMetrics }, null, 2),
        { mode: 0o600 },
      )
      appendFileSync(join(root, 'fleet-workspaces.txt'), `${fleetRoot}\n`, { mode: 0o600 })
    }
  }
  const report = {
    image,
    platform: 'linux/amd64',
    node: process.version,
    host: {
      osRelease: release(),
      cpu: cpus()[0]?.model,
      logicalCpus: cpus().length,
      totalMemoryBytes: totalmem(),
    },
    controls,
    measurements,
    note: 'All CLI timings include Docker/JVM startup. Image pull excluded. No RSS measurement. Synthetic fixtures: 1 account/session, 100 shared questions, 25 attempts/evidence rows per personal DB. Personal counts exclude 2 central DBs. Snapshots are preservation fixtures, not scored quiz payloads.',
  }
  writeFileSync(join(root, 'results.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 })
  return root
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] !== 'experiment' || process.argv[3] !== '--offline') {
    throw new Error(
      'Usage: node scripts/flyway-prototype.ts experiment --offline (synthetic scratch only)',
    )
  }
  console.log(await experiment())
}
