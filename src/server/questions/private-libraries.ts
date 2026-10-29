import { chmodSync, existsSync, lstatSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { validateManagedDatabase } from './managed-database.ts'
import { ApplicationError } from '../http/errors.ts'
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
    if (!existsSync(this.directory)) {
      throw new ApplicationError('Workspace pending external provisioning.', 503)
    }
    const directory = lstatSync(this.directory)
    if (directory.isSymbolicLink() || !directory.isDirectory()) {
      throw new Error('Private library directory must be a real directory.')
    }
    const path = join(this.directory, `${accountId}.sqlite3`)
    if (!existsSync(path)) {
      throw new ApplicationError('Workspace pending external provisioning.', 503)
    }
    const file = lstatSync(path)
    if (file.isSymbolicLink() || !file.isFile()) {
      throw new Error('Private library must be a regular file.')
    }
    const probe = new DatabaseSync(path, { readOnly: true })
    try {
      validateManagedDatabase(probe, accountId)
    } finally {
      probe.close()
    }
    chmodSync(this.directory, 0o700)
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
}
