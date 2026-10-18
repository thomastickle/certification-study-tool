import assert from 'node:assert/strict'
import { test } from 'node:test'
import { LibraryRepository } from '../src/server/questions/library-repository.ts'
import { ImportService } from '../src/server/importer/import-service.ts'
import { selectQuestions, shuffled } from '../src/server/quizzes/quiz-selection.ts'
import { examDomain } from '../src/server/quizzes/domain-mapping.ts'
import { bank } from './fixtures.ts'
import { populate } from './quiz-fixtures.ts'

test('selection excludes duplicates, unmapped records and other exams; source/type filters are enforced', () => {
  const repository = new LibraryRepository(':memory:')
  try {
    const input = populate(repository)
    const duplicate = structuredClone(input)
    duplicate.source.key = 'official'
    duplicate.source.name = 'Official'
    duplicate.source.type = 'official'
    duplicate.source.verification_status = 'official_current'
    const importer = new ImportService(repository)
    importer.confirm(duplicate, importer.preview(duplicate).token, false)
    const options = { sourceFilter: 'mixed' as const, questionType: 'mixed' as const }
    const selected = selectQuestions(
      repository.allQuestions(),
      repository.sources(),
      options,
      new Set(),
      () => 0.3,
    )
    assert.equal(new Set(selected.map((q) => q.record.fingerprint)).size, 20)
    assert.ok(selected.every((q) => q.record.sourceName === 'Official'))
    assert.throws(
      () =>
        selectQuestions(
          repository.allQuestions(),
          repository.sources(),
          { ...options, questionType: 'single_select' },
          new Set(),
        ),
      /Domain 3 needs 7/,
    )
    const onlyThird = selectQuestions(
      repository.allQuestions(),
      repository.sources(),
      { ...options, sourceFilter: 'third_party' },
      new Set(),
    )
    assert.ok(onlyThird.every((q) => q.record.sourceName === 'quiz-synthetic'))
    const foreign = repository.sources().map((source) => ({ ...source, certification: 'OTHER' }))
    assert.throws(
      () => selectQuestions(repository.allQuestions(), foreign, options, new Set()),
      /only 0/,
    )
    const unmapped = repository
      .allQuestions()
      .map((q) => ({ ...q, data: { ...q.data, classification: undefined, source_metadata: null } }))
    assert.throws(
      () => selectQuestions(unmapped, repository.sources(), options, new Set()),
      /only 0/,
    )
  } finally {
    repository.close()
  }
  const question = bank().questions[0]!
  assert.equal(examDomain(question), null)
  question.classification = { area: 'Identity & security', topic: 'IAM permissions & roles' }
  assert.equal(examDomain(question), 2)
  question.classification = { area: 'Cloud fundamentals', topic: 'Regions & Availability Zones' }
  assert.equal(examDomain(question), 3)
  assert.deepEqual(
    shuffled([1, 2, 3], () => 0),
    [2, 3, 1],
  )
})

test('boosted question receives three units of probability versus one and cannot repeat within a quiz', () => {
  const repository = new LibraryRepository(':memory:')
  try {
    populate(repository)
    const rows = repository.allQuestions()
    const boost = rows[0]!.fingerprint
    // First domain's 12 candidates: boosted first entry covers [0,3) of total14.
    const selected = selectQuestions(
      rows,
      repository.sources(),
      { sourceFilter: 'mixed', questionType: 'mixed' },
      new Set([boost]),
      () => 0.15,
    )
    assert.ok(selected.some((q) => q.record.fingerprint === boost))
    const normal = selectQuestions(
      rows,
      repository.sources(),
      { sourceFilter: 'mixed', questionType: 'mixed' },
      new Set(),
      () => 0.15,
    )
    assert.equal(
      normal.some((q) => q.record.fingerprint === boost),
      false,
    )
  } finally {
    repository.close()
  }
})
