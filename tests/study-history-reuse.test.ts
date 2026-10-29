import { prepareManagedDatabase } from './managed-database-fixture.ts'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { LibraryRepository } from '../src/server/questions/library-repository.ts'
import { QuizService } from '../src/server/quizzes/quiz-service.ts'
import { masteryHistory } from '../src/server/quizzes/mastery-history.ts'
import { completedRecency } from '../src/server/concepts/concept-variations.ts'
import { populate } from './quiz-fixtures.ts'
import { selectQuestions } from '../src/server/quizzes/quiz-selection.ts'
import { currentQuestionIdentities } from '../src/server/quizzes/question-identity.ts'

const options = { sourceFilter: 'mixed', questionType: 'mixed' }

test('one saved-content validation supplies mastery and recency, including incomplete scoring', () => {
  const repository = new LibraryRepository(prepareManagedDatabase())
  try {
    populate(repository)
    const service = new QuizService(
      repository,
      () => 1000,
      () => 0.2,
    )
    const quiz = service.start(options)
    service.submit(quiz.id, {
      answers: quiz.questions.map((question) => ({ ...question, selected: [], confidence: null })),
    })
    const saved = repository.quizStore().completed()[0]!
    // Valid content with unknown scoring must still count as an encounter and as recency.
    delete saved.questions[0]!.correct
    saved.questions[1]!.correctAnswerIds = [999]
    const later = structuredClone(saved)
    later.id = 'later'
    later.finishedAt = 2000
    later.options = { ...later.options, provider: 'Other' }
    const unfinished = { ...saved, status: 'active' as const, finishedAt: 3000 }
    const invalidTime = { ...structuredClone(saved), id: 'invalid-time', finishedAt: NaN }
    const attempts = [later, saved, unfinished, invalidTime]
    const expectedRecency = completedRecency(attempts)
    const before = structuredClone(attempts)
    const reads: number[] = []
    for (const attempt of [later, saved, invalidTime]) {
      for (const question of attempt.questions) {
        const text = question.question
        const index = reads.push(0) - 1
        Object.defineProperty(question, 'question', {
          enumerable: true,
          get: () => {
            reads[index]!++
            return text
          },
        })
      }
    }
    const history = masteryHistory(attempts)
    assert.equal(
      history.states.size,
      38,
      'Contradictory keys and unfinished attempts add no identity',
    )
    for (const [identity, state] of history.states) {
      assert.deepEqual(state, {
        encounters: expectedRecency.get(identity) === 2000 ? 1 : 2,
        mastered: false,
        masteryOrigin: null,
        boosted: false,
        required: 0,
        progress: 0,
        recovery: null,
        missDay: null,
        lastCreditDay: null,
        dueDay: null,
        retentionPassed: 0,
      })
    }
    assert.deepEqual(history.recency, expectedRecency)
    assert.ok(
      reads.every((count) => count <= 1),
      'Never normalize a saved question twice',
    )
    assert.equal(reads[0], 1, 'Incomplete scoring still validates saved content once')
    assert.deepEqual(attempts, before, 'Derived state never changes saved evidence')
  } finally {
    repository.close()
  }
})

test('quiz and review starts load each library once and use persisted history', () => {
  const repository = new LibraryRepository(prepareManagedDatabase())
  try {
    populate(repository)
    let now = 1000
    const service = new QuizService(
      repository,
      () => now,
      () => 0.2,
    )
    const first = service.start(options)
    const saved = repository.quizStore().find(first.id)!
    service.submit(first.id, {
      answers: first.questions.map((question, index) => ({
        ...question,
        selected: saved.keys[index]!.correct,
        confidence: 'Confident',
      })),
    })
    now += 8 * 86400000
    const store = repository.quizStore()
    repository.quizStore = () => store
    let histories = 0
    let questions = 0
    let sources = 0
    const completed = store.completed.bind(store)
    store.completed = (...args) => {
      histories++
      return completed(...args)
    }
    const allQuestions = repository.allQuestions.bind(repository)
    repository.allQuestions = () => {
      questions++
      return allQuestions()
    }
    const allSources = repository.sources.bind(repository)
    repository.sources = () => {
      sources++
      return allSources()
    }
    for (const mode of ['quiz', 'review'] as const) {
      histories = questions = sources = 0
      assert.equal(service.start({ ...options, mode }).questions.length, 20)
      assert.deepEqual(
        { histories, questions, sources },
        { histories: 0, questions: 1, sources: 1 },
      )
    }
  } finally {
    repository.close()
  }
})

test('indexed identities preserve deterministic weighted variation draws', () => {
  const repository = new LibraryRepository(prepareManagedDatabase())
  try {
    populate(repository)
    const records = repository.allQuestions()
    const sources = repository.sources()
    const identities = currentQuestionIdentities(records, sources)
    const values = [...identities.values()].filter((value) => value !== null)
    const groups = [
      {
        id: 'a',
        name: 'A',
        provider: 'AWS',
        certification: 'CLF-C02',
        identities: values.slice(0, 5),
      },
      {
        id: 'b',
        name: 'B',
        provider: 'AWS',
        certification: 'CLF-C02',
        identities: values.slice(3, 9),
      },
    ]
    const concepts = {
      groups,
      recency: new Map(values.map((identity, index) => [identity, index])),
    }
    const boosted = new Set(
      records.filter((_, index) => index % 3 === 0).map((record) => record.fingerprint),
    )
    for (const draw of [0, 0.15, 0.3, 0.75, 0.99]) {
      const expected = selectQuestions(
        records,
        sources,
        { sourceFilter: 'mixed', questionType: 'mixed' },
        boosted,
        () => draw,
        concepts,
      )
      const actual = selectQuestions(
        records,
        sources,
        { sourceFilter: 'mixed', questionType: 'mixed' },
        boosted,
        () => draw,
        concepts,
        identities,
      )
      assert.deepEqual(actual, expected)
    }
  } finally {
    repository.close()
  }
})

test('reusing a service never retains history or library state between requests', () => {
  const repository = new LibraryRepository(prepareManagedDatabase())
  try {
    populate(repository)
    let now = 1000
    const service = new QuizService(
      repository,
      () => now,
      () => 0.2,
    )
    assert.equal(service.due(options).total, 0)
    const first = service.start(options)
    const saved = repository.quizStore().find(first.id)!
    service.submit(first.id, {
      answers: first.questions.map((question, index) => ({
        ...question,
        selected: saved.keys[index]!.correct,
        confidence: 'Confident',
      })),
    })
    now += 8 * 86400000
    const completed = repository.quizStore().find(first.id)!
    const due = service.due(options)
    assert.equal(due.eligible, 20)
    service.deleteResult(first.id)
    assert.equal(service.due(options).total, 0)
    service.restoreResult(first.id)
    assert.deepEqual(service.due(options), due)
    for (const source of repository.sources()) {
      repository.deleteSource(source.id)
    }
    assert.equal(service.due(options).unavailable, 20)
    assert.deepEqual(repository.quizStore().find(first.id)!.questions, completed.questions)
    populate(repository, 12, 'replacement-source')
    assert.deepEqual(service.due(options), due)
    const deleted = service.deleteResult(first.id)!
    now = deleted.purgeAt
    assert.equal(service.due(options).total, 0)
    assert.equal(repository.quizStore().find(first.id), undefined)
    assert.throws(() => service.restoreResult(first.id), /not found/)
  } finally {
    repository.close()
  }
})
