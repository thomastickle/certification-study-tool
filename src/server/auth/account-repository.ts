import { createHash, randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'

export type Identity = { issuer: string; subject: string; name: string }

export type Account = { id: string; name: string }

/** Map verified external identities to application-owned account IDs. */
export class AccountRepository {
  private db: DatabaseSync

  constructor(path: string) {
    this.db = new DatabaseSync(path, { timeout: 5000 })
    const version = Number(this.db.prepare('PRAGMA user_version').get()?.user_version)
    const appId = Number(this.db.prepare('PRAGMA application_id').get()?.application_id)
    const occupied =
      Number(
        this.db
          .prepare("SELECT count(*) AS total FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'")
          .get()?.total,
      ) > 0
    if ((version === 0 && occupied) || (version !== 0 && (appId !== 1096242005 || version !== 1))) {
      this.db.close()
      throw new Error('Unrecognized account database. Use a separate application data directory.')
    }
    this.db.exec(`
      PRAGMA foreign_keys = ON;
      BEGIN IMMEDIATE;
      CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY, issuer TEXT NOT NULL, subject TEXT NOT NULL, name TEXT NOT NULL,
        UNIQUE(issuer, subject)
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id),
        expires_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
      PRAGMA application_id = 1096242005;
      PRAGMA user_version = 1;
      COMMIT;
    `)
  }

  /** Names are presentation only; an issuer and subject pair owns the account. */
  identify(identity: Identity): Account {
    this.db
      .prepare(
        `INSERT INTO accounts VALUES (?, ?, ?, ?)
      ON CONFLICT(issuer, subject) DO UPDATE SET name = excluded.name`,
      )
      .run(randomUUID(), identity.issuer, identity.subject, identity.name)
    return this.db
      .prepare('SELECT id, name FROM accounts WHERE issuer = ? AND subject = ?')
      .get(identity.issuer, identity.subject) as Account
  }

  saveSession(token: string, accountId: string, expiresAt: number): void {
    this.db
      .prepare('INSERT INTO sessions VALUES (?, ?, ?)')
      .run(tokenHash(token), accountId, expiresAt)
  }

  session(token: string, now: number): Account | undefined {
    this.db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now)
    return this.db
      .prepare(
        `SELECT a.id, a.name FROM sessions s JOIN accounts a ON a.id = s.account_id
      WHERE s.token_hash = ? AND s.expires_at > ?`,
      )
      .get(tokenHash(token), now) as Account | undefined
  }

  revokeSession(token: string): void {
    this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash(token))
  }

  close(): void {
    this.db.close()
  }
}

/** A database backup must not expose usable browser session credentials. */
function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}
