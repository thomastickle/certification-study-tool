import type { LibraryItemId } from './contracts.ts'

/** Only canonical positive database IDs are accepted, optionally in the private namespace. */
export function isLibraryItemId(value: unknown): value is LibraryItemId {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0
  }
  if (typeof value !== 'string' || !/^private:[1-9]\d*$/.test(value)) {
    return false
  }
  return Number.isSafeInteger(Number(value.slice('private:'.length)))
}

/** Resolve the source-picker query format without coercing unknown namespaces or malformed IDs. */
export function parseLibraryItemId(value: string): LibraryItemId | undefined {
  if (isLibraryItemId(value)) {
    return value
  }
  if (/^[1-9]\d*$/.test(value) && isLibraryItemId(Number(value))) {
    return Number(value)
  }
  return undefined
}

/** Namespace a database-local ID before combining shared and private content. */
export function privateItemId(id: LibraryItemId): `private:${number}` {
  if (typeof id !== 'number' || !isLibraryItemId(id)) {
    throw new Error('A private library record must have a positive local database ID.')
  }
  return `private:${id}`
}
