import { chmodSync, existsSync, lstatSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { validateDeploymentRoot, requireRealDirectory } from './managed-database.ts'
import { ApplicationError } from '../http/errors.ts'
import { LibraryRepository } from './library-repository.ts'

/** Open only the private library selected by a server-established internal account ID. */
export class PrivateLibraries {
  private directory: string
  private deploymentRoot: string

  constructor(directory: string, deploymentRoot = dirname(resolve(directory))) {
    this.directory = resolve(directory)
    this.deploymentRoot = deploymentRoot
  }

  /**
   * Return a request-owned connection; the caller must close it in a finally block.
   * @throws {Error} For invalid IDs, unsafe paths, or an unverifiable/mismatched database owner.
   */
  open(accountId: string): LibraryRepository {
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(accountId)) {
      throw new Error('A canonical internal account ID is required for a private library.')
    }
    validateDeploymentRoot(this.deploymentRoot)
    if (!existsSync(this.directory)) {
      throw new ApplicationError('Workspace pending external provisioning.', 503)
    }
    requireRealDirectory(this.directory)
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
    // Repository acquisition validates read-only before restricting/opening the file.
    const library = new LibraryRepository(path, accountId, {
      privateOwnerId: accountId,
      deploymentRoot: this.deploymentRoot,
    })
    try {
      chmodSync(this.directory, 0o700)
      return library
    } catch (error) {
      library.close()
      throw error
    }
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
