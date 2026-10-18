import assert from 'node:assert/strict'
import { test } from 'node:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { importBatch } from '../src/server/importer/batch-import.ts'
import { LibraryRepository } from '../src/server/questions/library-repository.ts'
import { bank } from './fixtures.ts'
import { ImportService } from '../src/server/importer/import-service.ts'

test('batch preview is non-mutating; apply retains duplicates and reimport is idempotent', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'study-batch-'))
  const database = join(directory, 'library.sqlite3')
  const files = ['first.json', 'second.json']
  try {
    files.forEach((file, i) =>
      writeFileSync(join(directory, file), JSON.stringify(bank(`source-${i}`))),
    )
    const options = { sourceDirectory: directory, database, files }
    const preview = await importBatch(options)
    assert.equal(existsSync(database), false)
    assert.equal(preview.applied, false)
    assert.deepEqual(
      preview.files.map((f) => [
        f.preview.total,
        f.preview.added,
        f.preview.duplicateCount,
        f.preview.conflicts,
      ]),
      [
        [1, 1, 0, []],
        [1, 1, 1, []],
      ],
    )
    const applied = await importBatch({ ...options, apply: true })
    assert.equal(applied.sources.length, 2)
    assert.equal(
      applied.sources.reduce((n, s) => n + s.questionCount, 0),
      2,
    )
    const bytes = readFileSync(database)
    await importBatch(options)
    assert.deepEqual(readFileSync(database), bytes)
    const repeated = await importBatch({ ...options, apply: true })
    assert.deepEqual(
      repeated.files.map((f) => [f.preview.added, f.preview.unchanged]),
      [
        [0, 1],
        [0, 1],
      ],
    )
    const repository = new LibraryRepository(database)
    try {
      assert.equal(repository.questions().total, 2)
      const metadata = repository.source('Example', 'DEMO-1', 'source-1')!.metadata
      assert.equal(
        (metadata.source as { verification_status: string }).verification_status,
        'unverified',
      )
    } finally {
      repository.close()
    }
  } finally {
    rmSync(directory, { recursive: true })
  }
})

test('invalid later bank reports file and source reference without writing any bank', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'study-invalid-batch-'))
  const database = join(directory, 'new.sqlite3')
  try {
    writeFileSync(join(directory, 'good.json'), JSON.stringify(bank('good')))
    const invalid = bank('bad')
    invalid.questions[0]!.select_count = 0
    invalid.questions[0]!.source_ref = 'invalid-reference'
    writeFileSync(join(directory, 'bad.json'), JSON.stringify(invalid))
    await assert.rejects(
      importBatch({
        sourceDirectory: directory,
        database,
        files: ['good.json', 'bad.json'],
        apply: true,
      }),
      /bad.json:.*\n[\s\S]*invalid-reference/,
    )
    assert.equal(existsSync(database), false)
  } finally {
    rmSync(directory, { recursive: true })
  }
})

test('conflicting answer keys block the whole batch; same-key different identities remain separate', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'study-conflict-batch-'))
  const database = join(directory, 'new.sqlite3')
  try {
    const first = bank('same-key')
    const second = bank('same-key')
    second.certification.code = 'DEMO-2'
    const third = bank('same-key')
    third.certification.provider = 'Another provider'
    ;[first, second, third].forEach((b, i) =>
      writeFileSync(join(directory, `${i}.json`), JSON.stringify(b)),
    )
    const options = {
      sourceDirectory: directory,
      database,
      files: ['0.json', '1.json', '2.json'],
      apply: true,
    }
    assert.equal((await importBatch(options)).sources.length, 3)
    const original = readFileSync(database)
    const conflicting = bank('conflicting')
    conflicting.questions[0]!.answers.forEach((a) => {
      a.correct = !a.correct
    })
    writeFileSync(join(directory, 'conflicting.json'), JSON.stringify(conflicting))
    await assert.rejects(
      importBatch({ ...options, files: ['conflicting.json'] }),
      /conflicting.json:[\s\S]*Conflicting[\s\S]*1/,
    )
    assert.deepEqual(readFileSync(database), original)
    await assert.rejects(
      importBatch({ ...options, files: ['0.json', '0.json'] }),
      /Repeated source identity/,
    )
    assert.deepEqual(readFileSync(database), original)
  } finally {
    rmSync(directory, { recursive: true })
  }
})

test('batch preserves omitted questions and unrelated sources; existing changes require separate review', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'study-preserve-batch-'))
  const database = join(directory, 'existing.sqlite3')
  try {
    writeFileSync(join(directory, 'unrelated.json'), JSON.stringify(bank('unrelated')))
    await importBatch({
      sourceDirectory: directory,
      database,
      files: ['unrelated.json'],
      apply: true,
    })
    const input = bank()
    input.questions.push({
      ...structuredClone(input.questions[0]!),
      source_ref: 'omitted',
      question: 'Another synthetic question?',
    })
    writeFileSync(join(directory, 'bank.json'), JSON.stringify(input))
    const options = { sourceDirectory: directory, database, files: ['bank.json'], apply: true }
    await importBatch(options)
    input.questions.pop()
    writeFileSync(join(directory, 'bank.json'), JSON.stringify(input))
    const result = await importBatch(options)
    assert.equal(result.sources.find((s) => s.key === input.source.key)!.questionCount, 2)
    assert.equal(result.sources.find((s) => s.key === 'unrelated')!.questionCount, 1)
    const original = readFileSync(database)
    input.questions[0]!.question = 'A changed question?'
    writeFileSync(join(directory, 'bank.json'), JSON.stringify(input))
    await assert.rejects(importBatch(options), /Review the changed questions/)
    assert.deepEqual(readFileSync(database), original)
    input.questions[0]!.question = bank().questions[0]!.question
    input.source.verification_status = 'verified_current'
    writeFileSync(join(directory, 'bank.json'), JSON.stringify(input))
    await assert.rejects(importBatch(options), /Review the changed questions/)
    assert.deepEqual(readFileSync(database), original)
  } finally {
    rmSync(directory, { recursive: true })
  }
})

test('outer batch transaction rolls back nested service confirmations and metadata', () => {
  const repository = new LibraryRepository(':memory:')
  try {
    assert.throws(
      () =>
        repository.transaction(() => {
          const input = bank()
          // Exercise the same public service transaction boundary used by the batch.
          const importer = new ImportService(repository)
          importer.confirm(input, importer.preview(input).token, false)
          throw new Error('Synthetic later failure')
        }),
      /Synthetic later failure/,
    )
    assert.deepEqual(repository.sources(), [])
    assert.equal(repository.questions().total, 0)
    assert.equal(repository.revision(), 0)
  } finally {
    repository.close()
  }
})

test('semantic validation rejects normalized answer collisions, repeated refs, and incorrect multi-select counts', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'study-semantics-batch-'))
  const database = join(directory, 'new.sqlite3')
  try {
    const ambiguous = bank()
    ambiguous.questions[0]!.answers[1]!.text = ' EXAMPLE A! '
    const repeated = bank()
    repeated.questions.push(structuredClone(repeated.questions[0]!))
    const multi = bank()
    multi.questions[0]!.type = 'multi_select'
    multi.questions[0]!.select_count = 3
    multi.questions[0]!.answers[1]!.correct = true
    for (const [input, error] of [
      [ambiguous, /indistinguishable/],
      [repeated, /duplicate source reference/],
      [multi, /select_count must match/],
    ] as const) {
      writeFileSync(join(directory, 'invalid.json'), JSON.stringify(input))
      await assert.rejects(
        importBatch({ sourceDirectory: directory, database, files: ['invalid.json'], apply: true }),
        error,
      )
      assert.equal(existsSync(database), false)
    }
  } finally {
    rmSync(directory, { recursive: true })
  }
})
