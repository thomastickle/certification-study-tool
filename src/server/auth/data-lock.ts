import { chmodSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

/** Reserve a data directory for either one server or one maintenance operation. */
export function lockDataDirectory(directory: string): () => void {
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const path = join(directory, '.runtime-lock.sqlite3')
  const lock = new DatabaseSync(path, { timeout: 0 })
  try {
    chmodSync(path, 0o600)
    lock.exec('BEGIN EXCLUSIVE')
  } catch {
    lock.close()
    throw new Error(
      'Application data is in use. Stop the study server and other maintenance commands first.',
    )
  }
  let released = false
  return () => {
    if (!released) {
      released = true
      lock.close()
    }
  }
}
