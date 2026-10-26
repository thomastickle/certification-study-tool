import type { DatabaseSync } from 'node:sqlite'

export type EarnedCertification = { provider: string; code: string; name: string }

/** Version earned credentials independently from library content and immutable quiz snapshots. */
export function migrateCertifications(db: DatabaseSync): void {
  db.exec('BEGIN IMMEDIATE')
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS certification_schema (version INTEGER PRIMARY KEY CHECK (version = 1));
      INSERT OR IGNORE INTO certification_schema VALUES (1);
      CREATE TABLE IF NOT EXISTS earned_certifications (
        provider TEXT NOT NULL, code TEXT NOT NULL, name TEXT NOT NULL,
        PRIMARY KEY (provider, code)
      );
      COMMIT;
    `)
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

/** Earned credentials survive bank deletion and do not alter study evidence. */
export class CertificationRepository {
  private db: DatabaseSync
  private accountId: string

  constructor(db: DatabaseSync, accountId = 'local') {
    this.db = db
    this.accountId = accountId
  }

  all(): EarnedCertification[] {
    return this.db
      .prepare(
        `
        SELECT provider, code, name
        FROM earned_certifications
        WHERE account_id = ?
        ORDER BY provider, code
      `,
      )
      .all(this.accountId) as EarnedCertification[]
  }

  setEarned(certification: EarnedCertification, earned: boolean): void {
    if (earned) {
      this.db
        .prepare(
          `INSERT INTO earned_certifications(account_id, provider, code, name)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(account_id, provider, code) DO UPDATE SET name = excluded.name`,
        )
        .run(this.accountId, certification.provider, certification.code, certification.name)
    } else {
      this.db
        .prepare(
          `
          DELETE FROM earned_certifications
          WHERE account_id = ? AND provider = ? AND code = ?
        `,
        )
        .run(this.accountId, certification.provider, certification.code)
    }
  }
}
