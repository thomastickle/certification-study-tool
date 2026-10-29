import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { schemaContract, sqlRoot } from './database-files.ts'

export type LegacyKind = 'accounts' | 'shared' | 'personal'

const conceptTables = ['concept_schema', 'reviewed_concepts', 'dismissed_concept_suggestions']
const certificationTables = ['certification_schema', 'earned_certifications']
const evidenceObjects = [
  'quiz_evidence',
  'quiz_evidence_insert',
  'quiz_evidence_update',
  'quiz_evidence_delete',
]

/** Compare declaration tokens without discarding whitespace or case inside SQL string literals. */
function declaration(sql: string): string {
  const tokens = sql.match(/'(?:''|[^'])*'|"(?:""|[^"])*"|[a-zA-Z_][a-zA-Z_0-9]*|[^\s]/g) ?? []
  return JSON.stringify(
    tokens.map((token) => {
      if (token.startsWith("'")) {
        return token
      }
      if (/^"[a-zA-Z_][a-zA-Z_0-9]*"$/.test(token)) {
        return token.slice(1, -1).toLowerCase()
      }
      return token.toLowerCase()
    }),
  )
}

/** Include all application/audit declarations and SQLite's independent column/index/FK metadata. */
function contract(db: DatabaseSync): string {
  const value = JSON.parse(schemaContract(db, true)) as { objects: { name: string; sql: string }[] }
  const declarations = new Map(
    db
      .prepare('SELECT name, sql FROM sqlite_master WHERE sql IS NOT NULL')
      .all()
      .map((row) => [String(row.name), String(row.sql)]),
  )
  for (const object of value.objects) {
    object.sql = declaration(declarations.get(object.name)!)
  }
  return JSON.stringify(value)
}

/** Independent early-release modules must be complete or wholly absent. */
function optionalGroup(actual: Set<string>, expected: DatabaseSync, group: string[]): void {
  const present = group.filter((name) => actual.has(name))
  if (present.length && present.length !== group.length) {
    throw new Error('Incomplete legacy schema extension.')
  }
  if (!present.length) {
    for (const name of group) {
      expected.exec(`DROP TABLE ${name}`)
    }
  }
}

/** Add only known declarations to an in-memory reference, never to an input database. */
function addDeclarations(expected: DatabaseSync, path: string, objects: string[]): void {
  const reference = new DatabaseSync(':memory:')
  try {
    reference.exec(readFileSync(path, 'utf8'))
    const select = reference.prepare('SELECT sql FROM sqlite_master WHERE name = ?')
    for (const name of objects) {
      const sql = select.get(name)?.sql
      if (typeof sql !== 'string') {
        throw new Error('Missing legacy contract declaration.')
      }
      expected.exec(sql)
    }
  } finally {
    reference.close()
  }
}

/** Model independently versioned extensions without repairing missing or partial input groups. */
function sharedExtensions(
  db: DatabaseSync,
  expected: DatabaseSync,
  actual: Set<string>,
  version: number,
): void {
  if (version === 2) {
    optionalGroup(actual, expected, conceptTables)
    optionalGroup(actual, expected, certificationTables)
  }
  if (version === 1) {
    for (const group of [conceptTables, certificationTables]) {
      if (group.some((name) => actual.has(name))) {
        if (!group.every((name) => actual.has(name))) {
          throw new Error('Incomplete legacy schema extension.')
        }
        addDeclarations(expected, join(sqlRoot, 'legacy-contracts/shared-v2.sql'), group)
      }
    }
  }
  if (evidenceObjects.some((name) => actual.has(name))) {
    if (version < 3 || !evidenceObjects.every((name) => actual.has(name))) {
      throw new Error('Incomplete or unsupported legacy evidence schema.')
    }
    addDeclarations(
      expected,
      join(sqlRoot, 'migrations/personal/V1__current_schema.sql'),
      evidenceObjects,
    )
  }
  if (actual.has('private_study_separation')) {
    addDeclarations(expected, join(sqlRoot, 'migrations/central/V1__current_schema.sql'), [
      'private_study_separation',
    ])
    const rows = db.prepare('SELECT singleton, complete FROM private_study_separation').all()
    if (
      rows.length !== 1 ||
      rows[0]?.singleton !== 1 ||
      ![0, 1].includes(Number(rows[0]?.complete))
    ) {
      throw new Error('Invalid legacy cleanup marker.')
    }
  }
  for (const marker of ['concept_schema', 'certification_schema']) {
    if (actual.has(marker)) {
      const rows = db.prepare(`SELECT version FROM ${marker}`).all()
      if (rows.length !== 1 || rows[0]?.version !== 1) {
        throw new Error('Invalid legacy schema marker.')
      }
    }
  }
}

/** Legacy auth/shared files have no audit history; managed personal files use the known Flyway layout. */
function auditHistory(db: DatabaseSync, expected: DatabaseSync, kind: LegacyKind): void {
  if (kind !== 'personal') {
    throw new Error('Unsupported legacy audit schema.')
  }
  expected.exec(readFileSync(join(sqlRoot, 'legacy-contracts/flyway-history.sql'), 'utf8'))
  const history = db
    .prepare(
      'SELECT version, type, script, success FROM flyway_schema_history ORDER BY installed_rank',
    )
    .all()
  if (
    history.length !== 1 ||
    history[0]?.version !== '1' ||
    history[0]?.type !== 'SQL' ||
    history[0]?.script !== 'V1__current_schema.sql' ||
    history[0]?.success !== 1
  ) {
    throw new Error('Unsupported legacy migration history.')
  }
}

/**
 * Validate a complete frozen per-role historical schema, including columns, constraints and objects.
 * Reference SQL executes only in memory; it never upgrades, repairs or baselines the input.
 * @throws {Error} For foreign objects, altered schemas or unsupported audit metadata.
 */
export function validateLegacySchema(db: DatabaseSync, kind: LegacyKind): string[] {
  const version = Number(db.prepare('PRAGMA user_version').get()?.user_version)
  const identity = db.prepare('PRAGMA application_id').get()?.application_id
  const versions = kind === 'accounts' ? [1, 2] : [1, 2, 3, 4]
  if (
    identity !== (kind === 'accounts' ? 1096242005 : 1096242004) ||
    !versions.includes(version) ||
    (kind === 'personal' && version !== 4)
  ) {
    throw new Error('Unsupported legacy identity/version.')
  }
  const actual = new Set(
    db
      .prepare("SELECT name FROM sqlite_master WHERE name NOT GLOB 'sqlite_*'")
      .all()
      .map((row) => String(row.name)),
  )
  const expected = new DatabaseSync(':memory:')
  try {
    const path =
      kind === 'personal'
        ? join(sqlRoot, 'migrations/personal/V1__current_schema.sql')
        : join(sqlRoot, 'legacy-contracts', `${kind}-v${version}.sql`)
    expected.exec(readFileSync(path, 'utf8'))
    if (kind === 'shared') {
      sharedExtensions(db, expected, actual, version)
    }
    if (actual.has('flyway_schema_history')) {
      auditHistory(db, expected, kind)
    }
    if (contract(db) !== contract(expected)) {
      throw new Error(`Unsupported ${kind} legacy schema contract.`)
    }
    const tables = expected
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT GLOB 'sqlite_*'")
      .all()
      .map((row) => String(row.name))
    if (db.prepare("SELECT name FROM sqlite_master WHERE name = 'sqlite_sequence'").get()) {
      const counters = new Set(
        tables.filter((name) => ['sources', 'questions', 'deleted_sources'].includes(name)),
      )
      for (const row of db.prepare('SELECT name, seq FROM sqlite_sequence').all()) {
        if (
          !counters.has(String(row.name)) ||
          !Number.isSafeInteger(row.seq) ||
          Number(row.seq) < 0
        ) {
          throw new Error('Unsupported legacy sequence metadata.')
        }
      }
    }
    return tables.filter(
      (name) =>
        !['flyway_schema_history', 'private_study_separation', 'private_library_owner'].includes(
          name,
        ),
    )
  } finally {
    expected.close()
  }
}
