import test from 'node:test'
import assert from 'node:assert/strict'
import type { QuizQuestion } from '../shared/quiz-contracts.ts'
import { filterResultQuestions, type ResultFilters } from './result-filters.ts'

const questions = [
  {
    questionId: 1,
    selected: [0],
    correct: true,
    confidence: 'Confident',
    sourceId: 1,
    flagged: false,
  },
  {
    questionId: 2,
    selected: [1],
    correct: false,
    confidence: 'Unsure',
    sourceId: 1,
    flagged: true,
  },
  { questionId: 3, selected: [], correct: false, confidence: null, sourceId: 2, flagged: false },
  {
    questionId: 4,
    selected: [0],
    correct: true,
    confidence: 'Educated Guess',
    sourceId: 2,
    flagged: false,
  },
] as QuizQuestion[]

/** Returns observable question identities for a combination of review filters. */
function ids(filters: Partial<ResultFilters>) {
  return filterResultQuestions(questions, {
    answer: 'all',
    confidence: 'all',
    source: 'all',
    ...filters,
  }).map((q) => q.questionId)
}

test('answer filters distinguish correct, incorrect, skipped and flagged evidence', () => {
  assert.deepEqual(ids({ answer: 'correct' }), [1, 4])
  assert.deepEqual(ids({ answer: 'incorrect' }), [2])
  assert.deepEqual(ids({ answer: 'skipped' }), [3])
  assert.deepEqual(ids({ answer: 'flagged' }), [2])
  assert.deepEqual(ids({}), [1, 2, 3, 4])
})

test('confidence and source filters intersect with answer filters, including empty matches', () => {
  assert.deepEqual(ids({ confidence: 'Confident' }), [1])
  assert.deepEqual(ids({ confidence: 'Educated Guess' }), [4])
  assert.deepEqual(ids({ confidence: 'Unsure', source: 'id:1', answer: 'incorrect' }), [2])
  assert.deepEqual(ids({ confidence: 'Not recorded' }), [3])
  assert.deepEqual(ids({ answer: 'correct', source: 'id:2' }), [4])
  assert.deepEqual(ids({ confidence: 'Unsure', source: 'id:2' }), [])
})
