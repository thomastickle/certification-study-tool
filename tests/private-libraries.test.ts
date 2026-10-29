import { prepareManagedDatabase } from './managed-database-fixture.ts'
import { writeFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { copyFileSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { PrivateLibraries } from '../src/server/questions/private-libraries.ts'
import { ImportService } from '../src/server/importer/import-service.ts'
import { bank } from './fixtures.ts'
import { LibraryRepository } from '../src/server/questions/library-repository.ts'

test('private library files survive restart and refuse a copied foreign-owner database', () => {
  const directory = mkdtempSync(join(tmpdir(), 'private-library-files-'))
  const alice = randomUUID()
  const bob = randomUUID()
  try {
    writeFileSync(join(directory, 'READY'), '1\n')
    prepareManagedDatabase(join(directory, `${alice}.sqlite3`), alice).close()
    prepareManagedDatabase(join(directory, `${bob}.sqlite3`), bob).close()
    const libraries = new PrivateLibraries(directory, directory)
    const own = libraries.open(alice)
    const input = bank('private-only')
    const importer = new ImportService(own)
    importer.confirm(input, importer.preview(input).token, false)
    own.close()
    const restarted = new PrivateLibraries(directory, directory).open(alice)
    assert.equal(restarted.sources().length, 1)
    restarted.close()
    assert.throws(() => new LibraryRepository(join(directory, `${alice}.sqlite3`)), /not ready/)
    const other = libraries.open(bob)
    assert.equal(other.sources().length, 0)
    other.close()
    assert.equal(statSync(join(directory, `${alice}.sqlite3`)).mode & 0o777, 0o600)
    copyFileSync(join(directory, `${alice}.sqlite3`), join(directory, `${bob}.sqlite3`))
    const before = readFileSync(join(directory, `${bob}.sqlite3`))
    assert.throws(() => libraries.open(bob), /not ready/)
    assert.deepEqual(readFileSync(join(directory, `${bob}.sqlite3`)), before)
    assert.throws(() => libraries.open('../outside'), /internal account ID/)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
