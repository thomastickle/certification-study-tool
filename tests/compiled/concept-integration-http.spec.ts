import { compatibilityFixture } from './compatibility-fixture.ts'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { LibraryRepository } from '../../src/server/questions/library-repository.ts'
import { ConceptService } from '../../src/server/concepts/concept-service.ts'
import { QuizService } from '../../src/server/quizzes/quiz-service.ts'
import { populate } from '../quiz-fixtures.ts'

const options = { sourceFilter: 'mixed', questionType: 'mixed' }

/** Create evidence for the first variation; leave its sibling unseen. */
function setup(
  questionsPerDomain: number,
  repository: LibraryRepository,
  study: import('../../src/server/questions/study-library.ts').StudyRepository,
) {
  populate(repository, questionsPerDomain)
  let now = Date.parse('2026-10-20T16:00:00Z')
  const quizzes = new QuizService(
    study,
    () => now,
    () => 0,
  )
  const concepts = new ConceptService(repository)
  const first = quizzes.start(options)
  const keys = study.quizStore().find(first.id)!.keys
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

test('concept HTTP routes preserve local mutation gates and reject stale saves atomically', async () => {
  const fixture = await compatibilityFixture()
  const { fetch, base } = fixture

  async function send(path: string, method: string, value?: unknown, origin = base) {
    return fetch(base + path, {
      method,
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: value === undefined ? undefined : JSON.stringify(value),
    })
  }

  try {
    const { group } = setup(12, fixture.shared, fixture.repository)
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
    await fixture.close()
  }
})
