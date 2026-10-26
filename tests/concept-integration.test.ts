import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'node:http'
import { LibraryRepository } from '../src/server/questions/library-repository.ts'
import { ConceptService } from '../src/server/concepts/concept-service.ts'
import { QuizService } from '../src/server/quizzes/quiz-service.ts'
import { apiController } from '../src/server/http-controller.ts'
import { populate } from './quiz-fixtures.ts'

const options = { sourceFilter: 'mixed', questionType: 'mixed' }

/** Create evidence for the first variation; leave its sibling unseen. */
function setup(questionsPerDomain = 12) {
  const repository = new LibraryRepository(':memory:')
  populate(repository, questionsPerDomain)
  let now = Date.parse('2026-10-20T16:00:00Z')
  const quizzes = new QuizService(
    repository,
    () => now,
    () => 0,
  )
  const concepts = new ConceptService(repository)
  const first = quizzes.start(options)
  const keys = repository.quizStore().find(first.id)!.keys
  quizzes.submit(first.id, {
    answers: first.questions.map((question, index) => ({
      ...question,
      selected: keys[index]!.correct,
      confidence: 'Confident',
    })),
  })
  const members = concepts
    .library()[0]!
    .members.filter((member) => ['d1-0', 'd1-11'].includes(member.occurrences[0]!.reference))
  const group = concepts.save({
    provider: 'AWS',
    certification: 'CLF-C02',
    name: 'Reviewed synthetic variations',
    members,
  })
  return {
    repository,
    quizzes,
    concepts,
    first,
    group,
    advance: () => {
      now += 7 * 86400000
    },
  }
}

test('normal selection prefers unseen eligible siblings without unnecessary same-concept repeats and snapshots labels', async () => {
  const { repository, quizzes, concepts, first, group } = setup()
  try {
    assert.equal(
      quizzes.get(first.id).questions.some((question) => 'concepts' in question),
      false,
      'past labels are never derived from live groups',
    )
    const quiz = quizzes.start(options)
    const domain = quiz.questions.filter((question) => question.domain === 1)
    assert.ok(
      domain.some((question) => question.reference === 'd1-11'),
      'unseen sibling should be preferred',
    )
    assert.ok(
      !domain.some((question) => question.reference === 'd1-0'),
      'other eligible concepts can fill the quota',
    )
    assert.deepEqual(
      [1, 2, 3, 4].map((id) => quiz.questions.filter((question) => question.domain === id).length),
      [5, 6, 7, 2],
    )
    assert.equal(new Set(quiz.questions.map((question) => question.question)).size, 20)
    const labelled = quiz.questions.find(
      (question) => question.reference === 'd1-11',
    )! as (typeof quiz.questions)[number] & { concepts?: { id: string; name: string }[] }
    assert.deepEqual(labelled.concepts, [{ id: group.id, name: group.name }])
    const keys = repository.quizStore().find(quiz.id)!.keys
    const result = quizzes.submit(quiz.id, {
      answers: quiz.questions.map((question, index) => ({
        ...question,
        selected: keys[index]!.correct,
        confidence: 'Confident',
      })),
    })
    concepts.save({ ...group, name: 'Renamed group' }, group.id)
    concepts.remove(group.id)
    repository.transaction(() =>
      repository.sources().forEach((source) => repository.deleteSource(source.id)),
    )
    assert.deepEqual(quizzes.get(quiz.id).questions, result.questions)
    const { quizReport } = await import('../src/shared/quiz-report.ts')
    assert.match(quizReport(quizzes.get(quiz.id)), /Reviewed synthetic variations/)
  } finally {
    repository.close()
  }
})

test('Due Review keeps actual due identity and never substitutes its unseen group sibling', () => {
  const { repository, quizzes, advance } = setup()
  try {
    advance()
    const due = quizzes.start({ ...options, mode: 'review' })
    assert.ok(due.questions.some((question) => question.reference === 'd1-0'))
    assert.ok(!due.questions.some((question) => question.reference === 'd1-11'))
    assert.equal(due.total, 20)
  } finally {
    repository.close()
  }
})

test('concept HTTP routes preserve local mutation gates and reject stale saves atomically', async () => {
  const { repository, group } = setup()
  const server = createServer(apiController(repository, { id: 'local', role: 'admin' }))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const base = `http://127.0.0.1:${address.port}`

  async function send(path: string, method: string, value?: unknown, origin = base) {
    return fetch(base + path, {
      method,
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: value === undefined ? undefined : JSON.stringify(value),
    })
  }

  try {
    const response = await fetch(base + '/api/concepts')
    assert.equal(response.status, 200)
    const data = await response.json()
    assert.equal(data.groups[0].id, group.id)
    assert.equal(
      (await send('/api/concepts', 'POST', group, 'https://untrusted.example')).status,
      403,
    )
    assert.equal(
      (await send(`/api/concepts/${group.id}`, 'PUT', group, 'https://untrusted.example')).status,
      403,
    )
    assert.equal(
      (await send(`/api/concepts/${group.id}`, 'DELETE', undefined, 'https://untrusted.example'))
        .status,
      403,
    )
    const suggestion = data.suggestions[0]
    assert.ok(suggestion)
    assert.equal(
      (
        await send(
          `/api/concept-suggestions/${suggestion.id}/dismiss`,
          'POST',
          {},
          'https://untrusted.example',
        )
      ).status,
      403,
    )
    assert.equal(
      (
        await send('/api/concepts', 'POST', {
          ...group,
          name: 'Invalid',
          members: [{ id: 99999, reviewToken: 'stale' }],
        })
      ).status,
      409,
    )
    assert.equal(
      (await send(`/api/concepts/${group.id}`, 'PUT', { ...group, name: 'HTTP rename' })).status,
      200,
    )
    assert.equal(
      (await send('/api/concepts', 'POST', { ...group, name: 'Manual HTTP group' })).status,
      201,
    )
    assert.equal(
      (await send(`/api/concept-suggestions/${suggestion.id}/dismiss`, 'POST', {})).status,
      200,
    )
    assert.equal((await send(`/api/concepts/${group.id}`, 'DELETE')).status, 200)
    const after = await (await fetch(base + '/api/concepts')).json()
    assert.equal(after.groups.length, 1)
    assert.equal(after.groups[0].name, 'Manual HTTP group')
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
    repository.close()
  }
})

test('a missed high-priority question is not replaced by its normal-priority sibling', () => {
  const { repository, quizzes, first } = setup()
  try {
    const saved = repository.quizStore().find(first.id)!
    const index = saved.questions.findIndex((question) => question.reference === 'd1-0')
    saved.questions[index]!.selected = [
      saved.questions[index]!.answers.find(
        (answer) => !saved.keys[index]!.correct.includes(answer.id),
      )!.id,
    ]
    saved.questions[index]!.correct = false
    repository.quizStore().save(saved)
    const quiz = quizzes.start(options)
    assert.ok(quiz.questions.some((question) => question.reference === 'd1-0'))
    assert.ok(!quiz.questions.some((question) => question.reference === 'd1-11'))
    assert.match(
      quiz.questions.find((question) => question.reference === 'd1-0')!.variationNote!,
      /No other reviewed variation/,
    )
  } finally {
    repository.close()
  }
})

test('question-type filters cannot reintroduce a reviewed alternate, and normal sibling success does not clear an actual due obligation', () => {
  const { repository, quizzes, advance } = setup(24)
  try {
    const filtered = quizzes.start({ ...options, questionType: 'single_select' })
    assert.ok(filtered.questions.every((question) => question.type === 'single_select'))
    assert.ok(filtered.questions.some((question) => question.reference === 'd1-0'))
    assert.match(
      filtered.questions.find((question) => question.reference === 'd1-0')!.variationNote!,
      /No other reviewed variation/,
    )
    quizzes.abandon(filtered.id)
    advance()
    const normal = quizzes.start(options)
    assert.ok(normal.questions.some((question) => question.reference === 'd1-11'))
    assert.ok(!normal.questions.some((question) => question.reference === 'd1-0'))
    const keys = repository.quizStore().find(normal.id)!.keys
    quizzes.submit(normal.id, {
      answers: normal.questions.map((question, index) => ({
        ...question,
        selected: keys[index]!.correct,
        confidence: 'Confident',
      })),
    })
    assert.equal(quizzes.due(options).total, 1)
    const review = quizzes.start({ ...options, mode: 'review' })
    assert.deepEqual(
      review.questions.map((question) => question.reference),
      ['d1-0'],
    )
  } finally {
    repository.close()
  }
})

test('concept preference preserves exam quotas and falls back when a quota requires repeated group variations', () => {
  const { repository, quizzes } = setup(24)
  try {
    const exam = quizzes.start({ ...options, mode: 'exam' })
    assert.equal(exam.total, 65)
    assert.deepEqual(
      [1, 2, 3, 4].map((id) => exam.questions.filter((question) => question.domain === id).length),
      [16, 19, 22, 8],
    )
    assert.ok(exam.questions.some((question) => question.reference === 'd1-11'))
    assert.ok(!exam.questions.some((question) => question.reference === 'd1-0'))
  } finally {
    repository.close()
  }
  const small = new LibraryRepository(':memory:')
  try {
    populate(small, 7)
    const concepts = new ConceptService(small)
    const members = concepts
      .library()[0]!
      .members.filter((member) => member.occurrences[0]!.reference.startsWith('d1-'))
    concepts.save({
      provider: 'AWS',
      certification: 'CLF-C02',
      name: 'Only domain-one group',
      members,
    })
    const quiz = new QuizService(
      small,
      () => 1000,
      () => 0,
    ).start(options)
    const domain = quiz.questions.filter((question) => question.domain === 1)
    assert.equal(domain.length, 5)
    assert.equal(new Set(domain.map((question) => question.question)).size, 5)
  } finally {
    small.close()
  }
})

test('source filters cannot pull a grouped alternate back into the selected bank', async () => {
  const { repository, quizzes } = setup()
  try {
    const { bank } = await import('./fixtures.ts')
    const { ImportService } = await import('../src/server/importer/import-service.ts')
    const original = repository.allQuestions().find((record) => record.reference === 'd1-11')!
    const other = bank('alternate-bank')
    other.certification = { provider: 'AWS', code: 'CLF-C02', name: 'Synthetic CLF-C02' }
    other.questions = [structuredClone(original.data)]
    const importer = new ImportService(repository)
    importer.confirm(other, importer.preview(other).token, false)
    const changed = structuredClone(original.data)
    changed.question = 'Edited source-local synthetic variant?'
    const { fingerprint, answerKey } = await import('../src/server/importer/bank-tools.ts')
    repository.transaction(() =>
      repository.saveQuestion(
        original.sourceId,
        original.reference,
        JSON.stringify(changed),
        fingerprint(changed),
        answerKey(changed),
      ),
    )
    const quiz = quizzes.start({ ...options, sourceIds: [original.sourceId] })
    assert.ok(quiz.questions.every((question) => question.sourceName === original.sourceName))
    assert.ok(quiz.questions.some((question) => question.reference === 'd1-0'))
    assert.match(
      quiz.questions.find((question) => question.reference === 'd1-0')!.variationNote!,
      /No other reviewed variation/,
    )
  } finally {
    repository.close()
  }
})
