import { createHash, randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import type { SessionUser, StudyRole } from '../../shared/auth-contracts.ts'

export type Identity = { issuer: string; subject: string; name: string; role?: StudyRole }

export type Account = { id: string; name: string }

/** Map verified external identities to application-owned account IDs. */
export class AccountRepository {
  private db: DatabaseSync

  constructor(path: string) {
    this.db = new DatabaseSync(path, { timeout: 5000 })
    try {
      const version = Number(this.db.prepare('PRAGMA user_version').get()?.user_version)
      const appId = Number(this.db.prepare('PRAGMA application_id').get()?.application_id)
      const existingTables = this.db.prepare(`
        SELECT count(*) AS total
        FROM sqlite_master
        WHERE name NOT LIKE 'sqlite_%'
      `)
      const occupied = Number(existingTables.get()?.total) > 0
      const unrecognizedSchema = version === 0 && occupied
      const incompatibleVersion =
        version !== 0 && (appId !== 1096242005 || ![1, 2].includes(version))
      if (unrecognizedSchema || incompatibleVersion) {
        throw new Error('Unrecognized account database. Use a separate application data directory.')
      }
      this.db.exec(`
      PRAGMA foreign_keys = ON;
      BEGIN IMMEDIATE;
      CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY,
        issuer TEXT NOT NULL,
        subject TEXT NOT NULL,
        name TEXT NOT NULL,
        UNIQUE(issuer, subject)
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES accounts(id),
        expires_at INTEGER NOT NULL,
        role TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('admin', 'student'))
      );
      CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
    `)
      if (version === 1) {
        this.db.exec(
          "ALTER TABLE sessions ADD COLUMN role TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('admin', 'student'))",
        )
      }
      this.db.exec('PRAGMA application_id = 1096242005; PRAGMA user_version = 2; COMMIT;')
    } catch (error) {
      this.db.close()
      throw error
    }
  }

  /** Names are presentation only; an issuer and subject pair owns the account. */
  identify(identity: Identity): Account {
    const upsertAccount = this.db.prepare(`
      INSERT INTO accounts VALUES (?, ?, ?, ?)
      ON CONFLICT(issuer, subject) DO UPDATE
        SET name = excluded.name
    `)
    upsertAccount.run(randomUUID(), identity.issuer, identity.subject, identity.name)
    return this.findIdentity(identity.issuer, identity.subject)!
  }

  /** Resolve an exact issuer/subject identity without creating an account or changing its name. */
  findIdentity(issuer: string, subject: string): Account | undefined {
    const findAccount = this.db.prepare(`
      SELECT id, name
      FROM accounts
      WHERE issuer = ? AND subject = ?
    `)
    return findAccount.get(issuer, subject) as Account | undefined
  }

  saveSession(
    token: string,
    accountId: string,
    expiresAt: number,
    role: StudyRole = 'student',
  ): void {
    this.db
      .prepare('INSERT INTO sessions(token_hash, account_id, expires_at, role) VALUES (?, ?, ?, ?)')
      .run(tokenHash(token), accountId, expiresAt, role)
  }

  session(token: string, now: number, issuer: string): SessionUser | undefined {
    const findSession = this.db.prepare(`
      SELECT a.id, a.name, s.role
      FROM sessions s
      JOIN accounts a ON a.id = s.account_id
      WHERE s.token_hash = ? AND s.expires_at > ? AND a.issuer = ?
    `)
    return findSession.get(tokenHash(token), now, issuer) as SessionUser | undefined
  }

  /** Reclaim expired records during explicit session housekeeping, never during lookup. */
  pruneExpiredSessions(now: number): void {
    this.db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now)
  }

  revokeSession(token: string): void {
    this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash(token))
  }

  /** Operator revocation invalidates every browser session for an explicitly selected identity. */
  revokeAccountSessions(accountId: string): void {
    this.db.prepare('DELETE FROM sessions WHERE account_id = ?').run(accountId)
  }

  close(): void {
    this.db.close()
  }
}

/** A database backup must not expose usable browser session credentials. */
function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}
