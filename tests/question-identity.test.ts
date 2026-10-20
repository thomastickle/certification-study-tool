import type { StoredQuiz } from '../src/server/quizzes/quiz-repository.ts'
import assert from 'node:assert/strict'
import test from 'node:test'
import { answerKey, fingerprint } from '../src/server/importer/bank-tools.ts'
import {
  currentQuestionIdentity,
  completedQuestionIdentity,
} from '../src/server/quizzes/question-identity.ts'
import type { Source } from '../src/shared/contracts.ts'
import { bank } from './fixtures.ts'

const source: Source = {
  id: 1,
  name: 'Synthetic',
  key: 'one',
  kind: 'official',
  provider: 'AWS',
  certification: 'CLF-C02',
  certificationName: 'Cloud Practitioner',
  questionCount: 1,
}

/** Make a synthetic library record with real importer hashes. */
function record(data = bank().questions[0]!) {
  return {
    id: 1,
    sourceId: 1,
    sourceName: 'Synthetic',
    reference: 'one',
    data,
    fingerprint: fingerprint(data),
    answerKey: answerKey(data),
  }
}

test('identity shares importer normalization across duplicate sources and shuffled choices', () => {
  const original = record()
  const before = structuredClone(original)
  const identity = currentQuestionIdentity(original, source)
  assert.match(identity!, /^mastery:v1:[a-f0-9]{64}$/)
  const duplicate = record({
    ...original.data,
    question: ' WHICH option is a synthetic example! ',
    answers: [...original.data.answers].reverse(),
    source_ref: 'another',
    classification: { area: 'Changed', topic: 'Changed' },
  })
  assert.equal(
    currentQuestionIdentity(
      { ...duplicate, id: 99, sourceId: 9, reference: 'new' },
      { ...source, id: 9, key: 'two', kind: 'third_party' },
    ),
    identity,
  )
  assert.equal(currentQuestionIdentity(original, source), identity)
  assert.deepEqual(original, before)
  for (const data of [
    { ...original.data, question: 'Different question' },
    {
      ...original.data,
      answers: original.data.answers.map((a) => ({ ...a, correct: !a.correct })),
    },
    { ...original.data, type: 'multi_select' as const },
    {
      ...original.data,
      type: 'multi_select' as const,
      select_count: 2,
      answers: original.data.answers.map((a) => ({ ...a, correct: true })),
    },
    { ...original.data, answers: [{ text: 'Changed', correct: true }, original.data.answers[1]!] },
  ]) {
    assert.notEqual(currentQuestionIdentity(record(data), source), identity)
  }
  assert.notEqual(
    currentQuestionIdentity(original, { ...source, certification: 'OTHER' }),
    identity,
  )
  assert.notEqual(currentQuestionIdentity(original, { ...source, provider: 'OTHER' }), identity)
})

/** Synthetic historical content uses non-positional public answer IDs. */
function snapshot(): StoredQuiz {
  return {
    id: 'synthetic',
    status: 'completed',
    startedAt: 1,
    deadline: 2,
    finishedAt: 2,
    correctCount: 1,
    total: 1,
    serverNow: 2,
    options: { sourceFilter: 'mixed', questionType: 'mixed' },
    questions: [
      {
        questionId: 99,
        question: bank().questions[0]!.question,
        type: 'single_select',
        selectCount: 1,
        answers: [
          { id: 40, text: 'Example B' },
          { id: 90, text: 'Example A' },
        ],
        correctAnswerIds: [90],
        selected: [90],
        confidence: null,
        flagged: false,
        domain: 1,
        sourceName: 'Deleted source',
        sourceKind: 'official',
        reference: 'gone',
        area: null,
        topic: null,
      },
    ],
    keys: [{ fingerprint: 'untrusted-old-fingerprint', correct: [90] }],
  }
}

test('completed identity derives from saved content and agreeing answer IDs without mutation', () => {
  const quiz = snapshot()
  const before = structuredClone(quiz)
  const expected = currentQuestionIdentity(record(), source)
  assert.equal(completedQuestionIdentity(quiz, 0), expected)
  quiz.questions[0]!.answers.reverse()
  assert.equal(completedQuestionIdentity(quiz, 0), expected)
  quiz.questions[0]!.answers.reverse()
  assert.deepEqual(quiz, before)
  delete quiz.questions[0]!.correctAnswerIds
  assert.equal(completedQuestionIdentity(quiz, 0), expected)
  quiz.questions[0]!.correctAnswerIds = [90]
  quiz.keys = []
  assert.equal(completedQuestionIdentity(quiz, 0), expected)
  assert.notEqual(
    currentQuestionIdentity(record({ ...record().data, question: 'Library edited' }), source),
    expected,
  )
  assert.equal(completedQuestionIdentity(quiz, 0), expected)
})

test('incomplete, invalid, contradictory or unsupported historical evidence remains unknown', () => {
  const changes: ((quiz: StoredQuiz) => void)[] = [
    (q) => {
      q.status = 'active'
    },
    (q) => {
      delete q.questions[0]!.correctAnswerIds
      q.keys = []
    },
    (q) => {
      q.keys[0]!.correct = [40]
    },
    (q) => {
      q.questions[0]!.correctAnswerIds = []
    },
    (q) => {
      q.questions[0]!.correctAnswerIds = [0]
    },
    (q) => {
      q.questions[0]!.correctAnswerIds = [90, 90]
    },
    (q) => {
      q.questions[0]!.answers[0]!.id = 90
    },
    (q) => {
      q.questions[0]!.answers[0]!.text = 'EXAMPLE A!'
    },
    (q) => {
      q.questions[0]!.question = ''
    },
    (q) => {
      q.questions[0]!.selectCount = 2
    },
    (q) => {
      q.questions[0]!.type = 'unsupported' as 'single_select'
    },
    (q) => {
      q.keys[0]!.correct = [NaN]
    },
  ]
  for (const change of changes) {
    const quiz = snapshot()
    change(quiz)
    const before = structuredClone(quiz)
    assert.equal(completedQuestionIdentity(quiz, 0), null)
    assert.deepEqual(quiz, before)
  }
  assert.equal(completedQuestionIdentity(snapshot(), -1), null)
  assert.equal(completedQuestionIdentity(snapshot(), 1), null)
})
