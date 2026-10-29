import { createHash, randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { openManagedDatabase, validateManagedDatabase } from '../questions/managed-database.ts'
import type { SessionUser, StudyRole } from '../../shared/auth-contracts.ts'

export type Identity = { issuer: string; subject: string; name: string; role?: StudyRole }

export type Account = { id: string; name: string }

/** Map verified external identities to application-owned account IDs. */
export class AccountRepository {
  private db: DatabaseSync

  constructor(path: string | DatabaseSync) {
    if (typeof path === 'string') {
      this.db = openManagedDatabase(path)
    } else {
      validateManagedDatabase(path)
      this.db = path
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
