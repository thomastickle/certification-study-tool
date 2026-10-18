import assert from 'node:assert/strict'
import { test } from 'node:test'
import { LibraryRepository } from '../src/server/questions/library-repository.ts'
import { LibraryService } from '../src/server/questions/library-service.ts'
import { ImportService } from '../src/server/importer/import-service.ts'
import { bank } from './fixtures.ts'

test('question and source deletion affect only the selected occurrence/source and invalidate old previews', () => {
  const repository = new LibraryRepository(':memory:')
  try {
    const importer = new ImportService(repository)
    const library = new LibraryService(repository)
    for (const key of ['first', 'second']) {
      const input = bank(key)
      importer.confirm(input, importer.preview(input).token, false)
    }
    const pending = bank('third')
    const stale = importer.preview(pending)
    const first = repository.questions().items[0]!
    library.deleteQuestion(first.id)
    assert.equal(repository.questions().total, 1)
    assert.equal(repository.sources().length, 2)
    assert.throws(() => importer.confirm(pending, stale.token, false), /preview again/i)
    const second = repository.sources().find((s) => s.name === 'second')!
    library.deleteSource(second.id)
    assert.equal(repository.questions().total, 0)
    assert.equal(repository.sources().length, 1)
    assert.throws(() => library.deleteQuestion(first.id), /not found/i)
  } finally {
    repository.close()
  }
})
