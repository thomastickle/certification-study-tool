import { prepareManagedDatabase } from './managed-database-fixture.ts'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { completedRecency, preferVariation } from '../src/server/concepts/concept-variations.ts'
import type { ReviewedConcept } from '../src/server/concepts/concept-repository.ts'
import type { StoredQuiz } from '../src/server/quizzes/quiz-repository.ts'
import { QuizService } from '../src/server/quizzes/quiz-service.ts'
import { LibraryRepository } from '../src/server/questions/library-repository.ts'
import { completedQuestionIdentity } from '../src/server/quizzes/question-identity.ts'
import { populate } from './quiz-fixtures.ts'

const a = { identity: 'a', domain: 1, tier: 3 }
const b = { identity: 'b', domain: 1, tier: 3 }
const c = { identity: 'c', domain: 1, tier: 3 }
const groups: ReviewedConcept[] = [
  { id: 'ab', name: 'A and B', provider: 'AWS', certification: 'CLF-C02', identities: ['a', 'b'] },
  { id: 'bc', name: 'B and C', provider: 'AWS', certification: 'CLF-C02', identities: ['b', 'c'] },
]

test('variation preference uses direct groups, completed recency and the same weight/domain tier', () => {
  const recency = new Map([
    ['a', 20],
    ['b', 10],
  ])
  assert.equal(preferVariation(a, [a, b, c], groups, recency), b)
  assert.equal(preferVariation(a, [a, { ...b, tier: 1 }], groups, recency), a)
  assert.equal(preferVariation(a, [a, { ...b, domain: 2 }], groups, recency), a)
  assert.equal(preferVariation(a, [a, c], groups, recency), a, 'overlap is not transitive')
  assert.equal(
    preferVariation(a, [a], groups, recency),
    a,
    'filtered siblings do not re-enter eligibility',
  )
  assert.equal(preferVariation(a, [a, b], [], recency), a, 'suggestions alone have no effect')
  assert.equal(
    preferVariation(a, [a, b], groups, new Map(), () => 0),
    a,
  )
  assert.equal(
    preferVariation(a, [a, b], groups, new Map(), () => 0.99),
    b,
    'equal recency retains randomized eligibility',
  )
})

test('recency is grounded in completed snapshots and survives source deletion', () => {
  const repository = new LibraryRepository(prepareManagedDatabase())
  try {
    populate(repository)
    let now = 1000
    const service = new QuizService(
      repository,
      () => now,
      () => 0.3,
    )
    const view = service.start({ mode: 'quiz', sourceFilter: 'mixed', questionType: 'mixed' })
    now = 2000
    service.submit(view.id, {
      answers: view.questions.map((question) => ({
        questionId: question.questionId,
        selected: [],
        confidence: null,
        flagged: false,
      })),
    })
    const completed = repository.quizStore().completed()[0]!
    const identity = completedQuestionIdentity(completed, 0)!
    assert.equal(completedRecency([completed]).get(identity), 2000)
    const unfinished = { ...completed, status: 'active', finishedAt: 99999 } as StoredQuiz
    assert.equal(completedRecency([completed, unfinished]).get(identity), 2000)
    repository.transaction(() => {
      repository.sources().forEach((source) => repository.deleteSource(source.id))
    })
    assert.equal(completedRecency(repository.quizStore().completed()).get(identity), 2000)
  } finally {
    repository.close()
  }
})
