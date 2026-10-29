import type { DatabaseSync } from 'node:sqlite'
import type { Source } from '../../../src/shared/contracts.ts'
import type { StoredQuiz } from '../../../src/server/quizzes/quiz-repository.ts'
import { pinLegacySources } from '../../../src/server/questions/bank-provenance.ts'
import { requireStudyCleanup } from './study-separation.ts'

const studyTables = {
  quiz_sessions: 'account_id, id, status, started_at, data',
  quiz_mastery: 'account_id, fingerprint, boosted, correct_streak',
  earned_certifications: 'account_id, provider, code, name',
}

/**
 * Move one owner's evidence in a single attached-database transaction, leaving shared banks intact.
 * @throws {Error} For unsupported journaling, foreign ownership, or conflicting destination history.
 * Both databases roll back on a failed transfer. No library revision or account identity changes.
 */
export function migratePrivateStudy(
  db: DatabaseSync,
  destination: string,
  accountId: string,
): void {
  const secureDelete = Number(db.prepare('PRAGMA main.secure_delete').get()?.secure_delete)
  db.prepare('ATTACH DATABASE ? AS private_study').run(destination)
  try {
    transferStudyInTransaction(db, accountId)
  } finally {
    try {
      db.exec('DETACH DATABASE private_study')
    } finally {
      db.exec(`PRAGMA main.secure_delete = ${secureDelete === 2 ? 'FAST' : secureDelete}`)
    }
  }
}

/** Own the single transaction across both attached files, including rollback on any failed phase. */
function transferStudyInTransaction(db: DatabaseSync, accountId: string): void {
  db.exec('BEGIN IMMEDIATE')
  try {
    verifyMigrationPreconditions(db, accountId)
    const incoming = rejectConflictingEvidence(db, accountId)
    if (incoming) {
      requireStudyCleanup(db)
      // Clear removed study records from reusable pages, not just from SQL query results.
      db.exec('PRAGMA main.secure_delete = ON')
      transferOwnedRows(db, accountId)
      pinMigratedSources(db, accountId)
      // Session triggers invalidate destination evidence; restore the source cache only afterwards.
      db.prepare(
        `
        INSERT INTO private_study.quiz_evidence
        SELECT * FROM main.quiz_evidence WHERE account_id = ?
      `,
      ).run(accountId)
      deleteTransferredRows(db, accountId)
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

/**
 * Check journal modes and destination identity under write locks on both files.
 * @throws {Error} For unsupported journaling or a destination with the wrong owner/schema markers.
 */
function verifyMigrationPreconditions(db: DatabaseSync, accountId: string): void {
  // Lock both files before checking modes; another connection may have changed a cached mode.
  for (const database of ['main', 'private_study']) {
    const mode = db.prepare(`PRAGMA ${database}.journal_mode`).get()?.journal_mode
    if (mode !== 'delete') {
      throw new Error('Study migration requires DELETE journal mode in both stopped databases.')
    }
  }
  const owner = db
    .prepare('SELECT account_id FROM private_study.private_library_owner WHERE singleton = 1')
    .get()
  const version = db.prepare('PRAGMA private_study.user_version').get()?.user_version
  const appId = db.prepare('PRAGMA private_study.application_id').get()?.application_id
  if (owner?.account_id !== accountId || version !== 4 || appId !== 1096242004) {
    throw new Error('The destination is not the selected account’s private study database.')
  }
}

/**
 * Return the pending row count, allowing retries only when there is no history to combine.
 * @throws {Error} If source and destination both contain evidence, or a study table is missing.
 */
function rejectConflictingEvidence(db: DatabaseSync, accountId: string): number {
  let incoming = 0
  let existing = 0
  for (const table of [...Object.keys(studyTables), 'quiz_evidence']) {
    incoming += Number(
      db.prepare(`SELECT count(*) AS total FROM main.${table} WHERE account_id = ?`).get(accountId)
        ?.total,
    )
    existing += Number(
      db.prepare(`SELECT count(*) AS total FROM private_study.${table}`).get()?.total,
    )
  }
  if (incoming && existing) {
    throw new Error(
      'The private database already contains study evidence. Restore a consistent backup instead of combining histories.',
    )
  }
  return incoming
}

/** Copy all evidence unchanged before provenance pinning or any source deletion can begin. */
function transferOwnedRows(db: DatabaseSync, accountId: string): void {
  for (const [table, columns] of Object.entries(studyTables)) {
    db.prepare(
      `
      INSERT INTO private_study.${table} (${columns})
      SELECT ${columns} FROM main.${table} WHERE account_id = ?
    `,
    ).run(accountId)
  }
}

/** Remove only the transferred owner's evidence after every copy and provenance update succeeds. */
function deleteTransferredRows(db: DatabaseSync, accountId: string): void {
  for (const table of [...Object.keys(studyTables), 'quiz_evidence']) {
    db.prepare(`DELETE FROM main.${table} WHERE account_id = ?`).run(accountId)
  }
}

/** Resolve legacy source ambiguity while the original shared banks and filters are still available. */
function pinMigratedSources(db: DatabaseSync, accountId: string): void {
  const sources = db
    .prepare('SELECT id, provider, certification, name, kind FROM main.sources')
    .all() as Source[]
  const questions = db
    .prepare('SELECT source_id AS sourceId, reference FROM main.questions')
    .all() as { sourceId: number; reference: string }[]
  const attempts = db
    .prepare('SELECT id, data FROM private_study.quiz_sessions WHERE account_id = ?')
    .all(accountId)
  const update = db.prepare(
    'UPDATE private_study.quiz_sessions SET data = ? WHERE account_id = ? AND id = ?',
  )
  for (const row of attempts) {
    const quiz: StoredQuiz = JSON.parse(String(row.data))
    if (pinLegacySources(quiz, sources, questions)) {
      update.run(JSON.stringify(quiz), accountId, row.id!)
    }
  }
}
