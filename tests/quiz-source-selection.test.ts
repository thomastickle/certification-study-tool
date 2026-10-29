import { prepareManagedDatabase } from './managed-database-fixture.ts'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { LibraryRepository } from '../src/server/questions/library-repository.ts'
import { QuizService } from '../src/server/quizzes/quiz-service.ts'
import { ImportService } from '../src/server/importer/import-service.ts'
import { populate } from './quiz-fixtures.ts'

test('quiz uses only checked source banks, including a mixed official/third-party selection', () => {
  const repository = new LibraryRepository(prepareManagedDatabase())
  try {
    const input = populate(repository)
    const importer = new ImportService(repository)
    for (const [key, kind] of [
      ['second', 'third_party'],
      ['official', 'official'],
    ] as const) {
      const next = structuredClone(input)
      next.source.key = key
      next.source.name = key
      next.source.type = kind
      next.source.verification_status = kind === 'official' ? 'official_current' : 'unverified'
      next.questions.forEach((q) => {
        q.question = `${key} ${q.question}`
      })
      importer.confirm(next, importer.preview(next).token, false)
    }
    const sources = repository.sources()
    const second = sources.find((s) => s.key === 'second')!
    const service = new QuizService(
      repository,
      () => 1000,
      () => 0.2,
    )
    const selected = service.start({
      sourceFilter: 'mixed',
      sourceIds: [second.id],
      questionType: 'mixed',
    })
    assert.ok(selected.questions.every((q) => q.sourceName === 'second'))
    assert.deepEqual(selected.options.sourceIds, [second.id])
    const official = sources.find((s) => s.kind === 'official')!
    // Sample both ends of the pool; selection does not guarantee every chosen bank appears.
    let draw = 0
    const mixed = new QuizService(
      repository,
      () => 1000,
      () => (draw++ % 2 ? 0.85 : 0.15),
    ).start({ sourceFilter: 'mixed', sourceIds: [second.id, official.id], questionType: 'mixed' })
    assert.ok(mixed.questions.every((q) => ['second', 'official'].includes(q.sourceName)))
    assert.equal(new Set(mixed.questions.map((q) => q.sourceKind)).size, 2)
  } finally {
    repository.close()
  }
})

test('empty, invalid, repeated or unavailable source IDs are rejected instead of falling back to all sources', () => {
  const repository = new LibraryRepository(prepareManagedDatabase())
  try {
    populate(repository)
    const service = new QuizService(repository)
    for (const sourceIds of [[], [999], [-1], [1, 1], ['1'], null]) {
      assert.throws(
        () => service.start({ sourceFilter: 'mixed', sourceIds, questionType: 'mixed' }),
        /source/i,
      )
    }
    assert.equal(repository.quizStore().active().length, 0)
  } finally {
    repository.close()
  }
})
