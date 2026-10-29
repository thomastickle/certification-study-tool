import type { DatabaseSync } from 'node:sqlite'
import { openManagedDatabase, validateManagedDatabase } from './managed-database.ts'

export type LibraryOptions = { privateOwnerId?: string; deploymentRoot?: string }

/** Open only a prepared database; injected connections receive identical format checks. */
export function openLibraryDatabase(
  path: string | DatabaseSync,
  accountId: string,
  options: LibraryOptions,
): DatabaseSync {
  if (options.privateOwnerId && options.privateOwnerId !== accountId) {
    throw new Error('Private library owner does not match the selected account.')
  }
  if (typeof path === 'string') {
    return openManagedDatabase(path, options.privateOwnerId, options.deploymentRoot)
  }
  validateManagedDatabase(path, options.privateOwnerId)
  return path
}
