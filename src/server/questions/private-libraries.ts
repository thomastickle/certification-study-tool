import { chmodSync, existsSync, linkSync, lstatSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { LibraryRepository } from './library-repository.ts'

/** Open only the private library selected by a server-established internal account ID. */
export class PrivateLibraries {
  private directory: string

  constructor(directory: string) {
    this.directory = resolve(directory)
  }

  /**
   * Return a request-owned connection; the caller must close it in a finally block.
   * @throws {Error} For invalid IDs, unsafe paths, or an unverifiable/mismatched database owner.
   */
  open(accountId: string): LibraryRepository {
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(accountId)) {
      throw new Error('A canonical internal account ID is required for a private library.')
    }
    mkdirSync(this.directory, { recursive: true, mode: 0o700 })
    const directory = lstatSync(this.directory)
    if (directory.isSymbolicLink() || !directory.isDirectory()) {
      throw new Error('Private library directory must be a real directory.')
    }
    chmodSync(this.directory, 0o700)
    const path = join(this.directory, `${accountId}.sqlite3`)
    if (!existsSync(path)) {
      this.initialize(path, accountId)
    }
    const file = lstatSync(path)
    if (file.isSymbolicLink() || !file.isFile()) {
      throw new Error('Private library must be a regular file.')
    }
    this.verifyOwner(path, accountId)
    chmodSync(path, 0o600)
    return new LibraryRepository(path, accountId, { privateOwnerId: accountId })
  }

  /** Discover persisted owner files after restart, excluding incomplete installation files. */
  accounts(): string[] {
    if (!existsSync(this.directory)) {
      return []
    }
    return readdirSync(this.directory)
      .filter((name) =>
        /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.sqlite3$/.test(name),
      )
      .map((name) => name.slice(0, -'.sqlite3'.length))
  }

  /** Finish every pending owner transfer before the server starts accepting requests. */
  migrateFrom(shared: LibraryRepository): void {
    for (const accountId of shared.studyAccounts()) {
      const library = this.open(accountId)
      library.close()
      shared.moveStudyTo(join(this.directory, `${accountId}.sqlite3`), accountId)
    }
  }

  /** Install a complete empty database without replacing a file created by a concurrent process. */
  private initialize(path: string, accountId: string): void {
    const temporary = join(this.directory, `.initializing-${randomUUID()}.sqlite3`)
    try {
      const library = new LibraryRepository(temporary, accountId)
      library.close()
      chmodSync(temporary, 0o600)
      const db = new DatabaseSync(temporary)
      try {
        db.exec(`
          CREATE TABLE private_library_owner (
            singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
            account_id TEXT NOT NULL
          )
        `)
        db.prepare('INSERT INTO private_library_owner VALUES (1, ?)').run(accountId)
      } finally {
        db.close()
      }
      try {
        linkSync(temporary, path)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
          throw error
        }
      }
    } finally {
      rmSync(temporary, { force: true })
    }
  }

  /** Verify identity read-only before schema migrations or other writes can touch an existing file. */
  private verifyOwner(path: string, accountId: string): void {
    const db = new DatabaseSync(path, { readOnly: true })
    try {
      const owner = db
        .prepare('SELECT account_id FROM private_library_owner WHERE singleton = 1')
        .get()
      if (owner?.account_id !== accountId) {
        throw new Error('Private library owner does not match the authenticated account.')
      }
    } finally {
      db.close()
    }
  }
}
