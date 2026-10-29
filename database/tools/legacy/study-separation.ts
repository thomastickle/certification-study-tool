import type { DatabaseSync } from 'node:sqlite'

/** A new transfer invalidates cleanup even if a previous startup already finished it. */
export function requireStudyCleanup(db: DatabaseSync): void {
  ensureCleanupRecord(db)
  db.exec('UPDATE main.private_study_separation SET complete = 0 WHERE singleton = 1')
}

/**
 * Remove historical freelist data before HTTP starts, including after a prior interrupted cleanup.
 * @throws {Error} For pending study rows, unsupported journaling, or an unsuccessful VACUUM.
 * A failure leaves the completion marker unset so the next startup retries the physical cleanup.
 */
export function finishStudySeparation(db: DatabaseSync): void {
  db.exec('BEGIN IMMEDIATE')
  let complete: boolean
  try {
    verifyEmptySharedStudy(db)
    ensureCleanupRecord(db)
    complete =
      db.prepare('SELECT complete FROM main.private_study_separation WHERE singleton = 1').get()
        ?.complete === 1
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
  if (complete) {
    return
  }
  // Secure deletion covers current rows; VACUUM also removes pages freed by older schema upgrades.
  db.exec('VACUUM')
  db.exec('BEGIN IMMEDIATE')
  try {
    verifyEmptySharedStudy(db)
    db.exec('UPDATE main.private_study_separation SET complete = 1 WHERE singleton = 1; COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

/** This marker is shared-file metadata, never part of an account's private library. */
function ensureCleanupRecord(db: DatabaseSync): void {
  db.exec(`
    INSERT OR IGNORE INTO main.private_study_separation VALUES (1, 0);
  `)
}

/** Check under a write lock so stale connection mode caches cannot bypass the cleanup contract. */
function verifyEmptySharedStudy(db: DatabaseSync): void {
  if (db.prepare('PRAGMA main.journal_mode').get()?.journal_mode !== 'delete') {
    throw new Error('Shared study cleanup requires DELETE journal mode.')
  }
  for (const table of ['quiz_sessions', 'quiz_mastery', 'earned_certifications']) {
    if (Number(db.prepare(`SELECT count(*) AS total FROM main.${table}`).get()?.total) !== 0) {
      throw new Error('Shared study cleanup requires every account transfer to finish first.')
    }
  }
  // Derived rows can outlive a legacy table replacement. They are private evidence too.
  // Force the same physical cleanup before trusting an earlier completion marker.
  if (Number(db.prepare('SELECT count(*) AS total FROM main.quiz_evidence').get()?.total) > 0) {
    ensureCleanupRecord(db)
    db.exec(`
      DELETE FROM main.quiz_evidence;
      UPDATE main.private_study_separation SET complete = 0 WHERE singleton = 1;
    `)
  }
}
