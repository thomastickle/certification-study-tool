import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'
import { ImportService } from '../src/server/importer/import-service.ts'
import { LibraryRepository } from '../src/server/questions/library-repository.ts'
import { bank } from './fixtures.ts'

test('a saved library survives closing and reopening SQLite', () => {
  const directory = mkdtempSync(join(tmpdir(), 'study-synthetic-'))
  const path = join(directory, 'library.sqlite3')
  try {
    const repository = new LibraryRepository(path)
    const service = new ImportService(repository)
    const input = bank()
    service.confirm(input, service.preview(input).token, false)
    repository.close()
    const reopened = new LibraryRepository(path)
    try {
      assert.deepEqual(reopened.questions().items[0]!.data, input.questions[0])
    } finally {
      reopened.close()
    }
  } finally {
    rmSync(directory, { recursive: true })
  }
})

test('an existing unrelated SQLite database is refused without altering it', () => {
  const directory = mkdtempSync(join(tmpdir(), 'study-foreign-'))
  const path = join(directory, 'foreign.sqlite3')
  try {
    const foreign = new DatabaseSync(path)
    foreign.exec(
      "CREATE TABLE personal_data (value TEXT); INSERT INTO personal_data VALUES ('synthetic')",
    )
    foreign.close()
    assert.throws(() => new LibraryRepository(path), /separate application database/i)
    const checked = new DatabaseSync(path)
    try {
      assert.equal(checked.prepare('SELECT value FROM personal_data').get()?.value, 'synthetic')
      assert.equal(
        checked.prepare("SELECT count(*) AS total FROM sqlite_master WHERE type = 'table'").get()
          ?.total,
        1,
      )
    } finally {
      checked.close()
    }
  } finally {
    rmSync(directory, { recursive: true })
  }
})
