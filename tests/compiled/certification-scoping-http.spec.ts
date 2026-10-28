import { compatibilityFixture } from './compatibility-fixture.ts'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { LibraryRepository } from '../../src/server/questions/library-repository.ts'
import { ImportService } from '../../src/server/importer/import-service.ts'
import { QuizService } from '../../src/server/quizzes/quiz-service.ts'
import { populate } from '../quiz-fixtures.ts'

const scope = { provider: 'Example', certification: 'GEN-1' }
const filters = { sourceFilter: 'mixed', questionType: 'mixed' } as const

/** Import unclassified generic questions alongside the legacy CLF pool. */
function library(repository: LibraryRepository, size = 65) {
  const input = populate(repository)
  input.certification = { ...scope, code: scope.certification, name: 'Generic' }
  input.source.key = 'generic'
  input.source.name = 'Generic bank'
  input.questions = Array.from({ length: size }, (_, i) => {
    const question = structuredClone(input.questions[0]!)
    question.question = `Generic question ${i}?`
    question.source_ref = `g-${i}`
    delete question.source_metadata
    delete question.classification
    return question
  })
  const importer = new ImportService(repository)
  importer.confirm(input, importer.preview(input).token, false)
}

test('HTTP current, recent, due and reports honor the complete certification pair', async () => {
  const fixture = await compatibilityFixture()
  const { repository, fetch, base } = fixture
  const query = new URLSearchParams(scope)
  try {
    library(fixture.shared)
    const service = new QuizService(repository)
    const legacy = service.start(filters)
    const generic = service.start({ ...filters, ...scope })

    const get = async (path: string) => {
      const response = await fetch(`${base}${path}`)
      assert.equal(response.status, 200)
      return response.json()
    }

    assert.equal((await get(`/api/quizzes/current?${query}`)).id, generic.id)
    assert.equal((await get('/api/quizzes/current')).id, legacy.id)
    const stored = repository.quizStore().find(generic.id)!
    service.submit(generic.id, { answers: generic.questions })
    assert.deepEqual(
      (await get(`/api/quizzes?${query}`)).map((q: { id: string }) => q.id),
      [generic.id],
    )
    assert.deepEqual(await get('/api/quizzes'), [])
    assert.equal((await get(`/api/reports?${query}`)).counts.total, 20)
    assert.equal((await get(`/api/reports?${query}`)).provider, scope.provider)
    assert.equal((await get('/api/reports')).counts.total, 0)
    const otherProvider = {
      ...stored,
      id: 'other-provider',
      status: 'completed' as const,
      finishedAt: Date.now(),
      options: { ...stored.options, provider: 'Other' },
    }
    repository.quizStore().save(otherProvider)
    assert.equal((await get(`/api/reports?${query}`)).counts.total, 20)
    const historical = repository.quizStore().find(generic.id)!
    historical.startedAt -= 8 * 86400000
    historical.finishedAt! -= 8 * 86400000
    historical.questions.forEach((question, index) => {
      question.selected = historical.keys[index]!.correct
      question.correct = true
      question.confidence = 'Confident'
    })
    repository.quizStore().save(historical)
    assert.equal((await get(`/api/quizzes/due?${query}`)).total, 20)
    assert.equal((await get('/api/quizzes/due')).total, 0)
    for (const path of [
      '/api/reports?provider=',
      '/api/quizzes?certification=',
      '/api/quizzes/current?provider=',
      '/api/quizzes/due?provider=',
    ]) {
      assert.equal((await fetch(`${base}${path}`)).status, 400)
    }
  } finally {
    await fixture.close()
  }
})
