import assert from 'node:assert/strict'
import { test } from 'node:test'
import { LibraryRepository } from '../src/server/questions/library-repository.ts'
import { ImportService } from '../src/server/importer/import-service.ts'
import { ConceptService } from '../src/server/concepts/concept-service.ts'
import { bank } from './fixtures.ts'

/** Import synthetic variations through the public import boundary. */
function fixture() {
  const repository = new LibraryRepository(':memory:')
  const importer = new ImportService(repository)
  const input = bank()
  input.questions.push({
    ...structuredClone(input.questions[0]!),
    source_ref: '2',
    question: 'Another synthetic variation?',
  })
  const preview = importer.preview(input)
  importer.confirm(input, preview.token, true)
  return { repository, importer, input, service: new ConceptService(repository) }
}

test('suggestions explain shared labels without writing reviewed groups', () => {
  const { repository, service } = fixture()
  try {
    const revision = repository.revision()
    const suggestions = service.suggestions()
    assert.equal(suggestions.length, 1)
    assert.equal(repository.revision(), revision)
  } finally {
    repository.close()
  }
})

test('only explicit reviewed saves activate groups; dismissal stays inactive', () => {
  const { repository, service } = fixture()
  try {
    const candidate = service.suggestions()[0]!
    assert.deepEqual(service.groups(), [])
    service.dismiss(candidate.id)
    assert.deepEqual(service.suggestions(), [])
    assert.deepEqual(service.groups(), [])
    const group = service.save({ ...candidate, name: 'Reviewed examples' })
    assert.equal(service.groups().length, 1)
    assert.equal((group as { name: string }).name, 'Reviewed examples')
  } finally {
    repository.close()
  }
})

/** Confirm a changed synthetic bank without bypassing importer validation. */
function reimport(importer: ImportService, input: ReturnType<typeof bank>) {
  const preview = importer.preview(input)
  importer.confirm(input, preview.token, true)
}

test('manual groups permit direct overlaps, reject ambiguous names and roll back invalid members', () => {
  const { repository, service } = fixture()
  try {
    const candidate = service.suggestions()[0]!
    const first = service.save({ ...candidate, name: 'First' })
    const second = service.save({ ...candidate, name: 'Second', members: [candidate.members[0]] })
    assert.equal(service.groups().length, 2)
    assert.equal(second.members.length, 1)
    assert.throws(() => service.save({ ...candidate, name: ' FIRST ' }), /distinct concept name/)
    assert.throws(
      () =>
        service.save({
          ...candidate,
          name: 'Invalid',
          members: [candidate.members[0], { id: 9999, reviewToken: 'stale' }],
        }),
      /changed, disappeared/,
    )
    assert.equal(service.groups().length, 2)
    const renamed = service.save(
      { ...first, name: 'Renamed', members: [candidate.members[1]] },
      first.id,
    )
    assert.equal(renamed.name, 'Renamed')
    assert.equal(renamed.members.length, 1)
    service.remove(first.id)
    assert.deepEqual(
      service.groups().map((group) => group.id),
      [second.id],
    )
  } finally {
    repository.close()
  }
})

test('certification boundaries and missing labels never create accidental suggestions or memberships', () => {
  const { repository, importer, input, service } = fixture()
  try {
    const other = structuredClone(input)
    other.certification.code = 'OTHER'
    reimport(importer, other)
    const unclassified = structuredClone(input)
    unclassified.source.key = 'unclassified'
    unclassified.questions.forEach((question, index) => {
      question.question = `Unclassified synthetic ${index}?`
      delete question.classification
    })
    reimport(importer, unclassified)
    assert.equal(service.suggestions().length, 2)
    const [a, b] = service.suggestions()
    assert.throws(
      () => service.save({ ...a, members: [a!.members[0], b!.members[0]] }),
      /another certification/,
    )
    assert.equal(service.groups().length, 0)
    assert.throws(() => service.dismiss('stale'), /changed or disappeared/)
  } finally {
    repository.close()
  }
})

test('exact occurrences share membership, classification changes preserve it, content and key changes do not', () => {
  const { repository, importer, input, service } = fixture()
  try {
    const duplicate = structuredClone(input)
    duplicate.source.key = 'another-source'
    reimport(importer, duplicate)
    const candidate = service.suggestions()[0]!
    assert.equal(candidate.members.length, 2)
    assert.equal(candidate.members[0]!.occurrences.length, 2)
    const group = service.save(candidate)
    assert.throws(
      () =>
        service.save({
          ...candidate,
          name: 'Duplicate members',
          members: [candidate.members[0], candidate.members[0]],
        }),
      /one variation/,
    )
    input.questions[0]!.classification = { area: 'Changed area', topic: 'Changed topic' }
    reimport(importer, input)
    assert.equal(service.groups()[0]!.members[0]!.occurrences.length, 2)
    input.questions[0]!.question = 'Edited synthetic content?'
    reimport(importer, input)
    assert.equal(service.groups()[0]!.members[0]!.occurrences.length, 1)
    assert.throws(() => service.save(candidate, group.id), /changed, disappeared/)
    duplicate.questions[0]!.answers.forEach((answer) => {
      answer.correct = !answer.correct
    })
    reimport(importer, duplicate)
    assert.equal(service.groups()[0]!.members.length, 1)
    assert.equal(service.groups()[0]!.unavailableCount, 1)
    repository.transaction(() =>
      repository.deleteSource(
        repository.sources().find((source) => source.key === input.source.key)!.id,
      ),
    )
    assert.equal(service.groups()[0]!.members[0]!.occurrences.length, 1)
  } finally {
    repository.close()
  }
})

test('reviewed groups and dismissals survive reopening without changing bank records', async () => {
  const { mkdtempSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const directory = mkdtempSync(join(tmpdir(), 'synthetic-concepts-'))
  let repository = new LibraryRepository(join(directory, 'library.sqlite3'))
  try {
    const importer = new ImportService(repository)
    const input = bank()
    input.questions.push({
      ...structuredClone(input.questions[0]!),
      source_ref: '2',
      question: 'Synthetic second?',
    })
    reimport(importer, input)
    const service = new ConceptService(repository)
    const before = repository.allQuestions()
    const candidate = service.suggestions()[0]!
    service.dismiss(candidate.id)
    const group = service.save(candidate)
    repository.close()
    repository = new LibraryRepository(join(directory, 'library.sqlite3'))
    const reopened = new ConceptService(repository)
    assert.equal(reopened.groups()[0]!.id, group.id)
    assert.deepEqual(repository.allQuestions(), before)
    reopened.remove(group.id)
    assert.deepEqual(
      reopened.suggestions(),
      [],
      'dismissal is persisted separately from activation',
    )
  } finally {
    repository.close()
    rmSync(directory, { recursive: true })
  }
})

test('review DTOs expose useful provenance without private identity or importer hashes', () => {
  const { repository, service } = fixture()
  try {
    const json = JSON.stringify(service.library())
    assert.match(json, /synthetic-bank/)
    assert.match(json, /reviewToken/)
    assert.doesNotMatch(json, /fingerprint|answerKey|mastery:v1/)
    const candidate = service.suggestions()[0]!
    assert.throws(() => service.save({ ...candidate, name: 'Bad\u0000name' }), /concept name/)
  } finally {
    repository.close()
  }
})

test('renaming a group preserves unavailable reviewed identities after source deletion', () => {
  const { repository, service } = fixture()
  try {
    const candidate = service.suggestions()[0]!
    const group = service.save(candidate)
    repository.transaction(() => repository.deleteSource(repository.sources()[0]!.id))
    const renamed = service.save(
      { provider: group.provider, certification: group.certification, name: 'Retained review' },
      group.id,
    )
    assert.equal(renamed.name, 'Retained review')
    assert.equal(renamed.members.length, 0)
    assert.equal(renamed.unavailableCount, 2)
  } finally {
    repository.close()
  }
})
