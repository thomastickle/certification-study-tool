import { DatabaseSync } from 'node:sqlite'
import { migratePrivateStudy } from './migrate-private-study.ts'
import { finishStudySeparation } from './study-separation.ts'

/** Enumerate pending owners from a stopped staging copy, retaining the historical owner enumeration. */
export function studyAccounts(source: string): string[] {
  const db = new DatabaseSync(source, { readOnly: true })
  try {
    return db
      .prepare(
        `
      SELECT account_id FROM quiz_sessions
      UNION SELECT account_id FROM quiz_mastery
      UNION SELECT account_id FROM earned_certifications
    `,
      )
      .all()
      .map((row) => String(row.account_id))
  } finally {
    db.close()
  }
}

/** Transfer one owner using the retained atomic attached-database boundary. */
export function moveStudyTo(source: string, destination: string, owner: string): void {
  const db = new DatabaseSync(source)
  try {
    migratePrivateStudy(db, destination, owner)
  } finally {
    db.close()
  }
}

/** Transfer prepared owner files before physical cleanup; any failure remains retryable offline. */
export function transferFleet(
  source: string,
  destinationForOwner: (owner: string) => string,
): void {
  for (const owner of studyAccounts(source)) {
    moveStudyTo(source, destinationForOwner(owner), owner)
  }
  const db = new DatabaseSync(source)
  try {
    finishStudySeparation(db)
  } finally {
    db.close()
  }
}
