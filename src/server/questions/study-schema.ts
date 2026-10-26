import type { DatabaseSync } from 'node:sqlite'

/**
 * Attribute legacy study state explicitly before enabling account-scoped queries.
 * @throws {Error} For a missing owner or unexpected legacy schema; study changes roll back.
 */
export function migrateStudyOwnership(db: DatabaseSync, ownerId?: string): void {
  if (Number(db.prepare('PRAGMA user_version').get()?.user_version) !== 2) {
    return
  }
  db.exec('BEGIN IMMEDIATE')
  try {
    const legacyColumns = {
      quiz_sessions: ['id', 'status', 'started_at', 'data'],
      quiz_mastery: ['fingerprint', 'boosted', 'correct_streak'],
      earned_certifications: ['provider', 'code', 'name'],
    }
    let occupied = false
    for (const [table, expected] of Object.entries(legacyColumns)) {
      const columns = db
        .prepare(`PRAGMA table_xinfo(${table})`)
        .all()
        .map((column) => String(column.name))
      const knownSchema =
        columns.length === expected.length && expected.every((column) => columns.includes(column))
      if (!knownSchema) {
        throw new Error(
          'The legacy schema does not match the expected study ownership layout. No records were reassigned.',
        )
      }
      occupied ||= Number(db.prepare(`SELECT count(*) AS total FROM ${table}`).get()?.total) > 0
    }
    if (occupied && !ownerId?.trim()) {
      throw new Error(
        'Existing study history requires an explicit legacy owner before upgrading. Set STUDY_LEGACY_OWNER_SUBJECT to the previous owner subject.',
      )
    }
    db.exec(`
      CREATE TABLE owned_quiz_sessions (
        account_id TEXT NOT NULL,
        id TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        data TEXT NOT NULL,
        PRIMARY KEY (account_id, id)
      );
      CREATE INDEX quiz_sessions_status ON owned_quiz_sessions(status, account_id);
      CREATE TABLE owned_quiz_mastery (
        account_id TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        boosted INTEGER NOT NULL,
        correct_streak INTEGER NOT NULL,
        PRIMARY KEY (account_id, fingerprint)
      );
      CREATE TABLE owned_earned_certifications (
        account_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        code TEXT NOT NULL,
        name TEXT NOT NULL,
        PRIMARY KEY (account_id, provider, code)
      );
    `)
    const owner = ownerId ?? 'unassigned'
    const copyAttempts = db.prepare(`
      INSERT INTO owned_quiz_sessions
      SELECT ?, id, status, started_at, data FROM quiz_sessions
    `)
    const copyMastery = db.prepare(`
      INSERT INTO owned_quiz_mastery
      SELECT ?, fingerprint, boosted, correct_streak FROM quiz_mastery
    `)
    const copyCertifications = db.prepare(`
      INSERT INTO owned_earned_certifications
      SELECT ?, provider, code, name FROM earned_certifications
    `)
    copyAttempts.run(owner)
    copyMastery.run(owner)
    copyCertifications.run(owner)
    db.exec(`
      DROP TABLE quiz_sessions;
      DROP TABLE quiz_mastery;
      DROP TABLE earned_certifications;
      ALTER TABLE owned_quiz_sessions RENAME TO quiz_sessions;
      ALTER TABLE owned_quiz_mastery RENAME TO quiz_mastery;
      ALTER TABLE owned_earned_certifications RENAME TO earned_certifications;
      PRAGMA user_version = 3;
      COMMIT;
    `)
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}
