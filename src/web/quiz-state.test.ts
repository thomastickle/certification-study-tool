import test from 'node:test'
import assert from 'node:assert/strict'
import {
  meetsPracticeTarget,
  reviewQuestionIds,
  reviewAnswerState,
  warningThreshold,
} from './quiz-state.ts'
import type { QuizQuestion, QuizView } from '../shared/quiz-contracts.ts'

test('warning threshold follows server deadline, including crossed thresholds', () => {
  assert.equal(warningThreshold(10 * 60_000 - 1), '10-minute')
  assert.equal(warningThreshold(2 * 60_000 - 1), '2-minute')
  assert.equal(warningThreshold(0), '2-minute')
  assert.equal(warningThreshold(10 * 60_000), '10-minute')
  assert.equal(warningThreshold(2 * 60_000), '2-minute')
  assert.equal(warningThreshold(10 * 60_000 + 1), null)
})

test('review list includes only explicit flags regardless of answer or confidence', () => {
  const questions = [
    { questionId: 1, selectCount: 1, selected: [], confidence: null, flagged: false },
    { questionId: 2, selectCount: 1, selected: [1], confidence: 'Confident', flagged: true },
    { questionId: 3, selectCount: 1, selected: [1], confidence: 'Unsure', flagged: false },
    { questionId: 4, selectCount: 1, selected: [1], confidence: 'Educated Guess', flagged: false },
    { questionId: 5, selectCount: 1, selected: [1], confidence: 'Confident', flagged: false },
  ] as QuizQuestion[]
  assert.deepEqual(reviewQuestionIds(questions), [2])
})

test('80 percent practice target passes at the boundary only', () => {
  assert.equal(meetsPracticeTarget(79), false)
  assert.equal(meetsPracticeTarget(80), true)
  assert.equal(meetsPracticeTarget(100), true)
})

test('a delayed poll cannot erase a newer saved answer or a pending failed save', async () => {
  const { mergeQuizPoll } = await import('./quiz-state.ts')
  const base: QuizView = {
    id: 'quiz',
    status: 'active',
    serverNow: 1000,
    startedAt: 1000,
    deadline: 1201000,
    finishedAt: null,
    correctCount: null,
    total: 1,
    options: { sourceFilter: 'mixed', questionType: 'mixed' },
    questions: [
      {
        questionId: 0,
        question: 'Synthetic question?',
        type: 'single_select',
        selectCount: 1,
        answers: [{ id: 0, text: 'Example' }],
        domain: 1,
        sourceName: 'Synthetic',
        sourceKind: 'third_party',
        reference: '1',
        area: null,
        topic: null,
        selected: [],
        confidence: null,
        flagged: false,
      },
    ],
  }
  let resolvePoll!: (view: typeof base) => void
  const delayed = new Promise<typeof base>((resolve) => {
    resolvePoll = resolve
  })
  const saved = {
    ...base,
    serverNow: 2000,
    questions: [
      { ...base.questions[0]!, selected: [0], confidence: 'Unsure' as const, flagged: true },
    ],
  }
  resolvePoll(structuredClone(base))
  const reconciled = mergeQuizPoll(saved, await delayed)
  assert.deepEqual(reconciled.questions[0]!.selected, [0])
  assert.equal(reconciled.questions[0]!.flagged, true)
  assert.equal(reconciled.serverNow, 2000)
  const complete = { ...saved, status: 'completed' as const, correctCount: 1 }
  assert.equal(mergeQuizPoll(saved, complete).status, 'completed')
  assert.equal(mergeQuizPoll(complete, base).status, 'completed')
})

test('practice clock uses hours, minutes and seconds for both session lengths', async () => {
  const { formatTime } = await import('./quiz-state.ts')
  assert.equal(formatTime(5400), '01:30:00')
  assert.equal(formatTime(1200), '00:20:00')
  assert.equal(formatTime(59), '00:00:59')
  assert.equal(formatTime(0), '00:00:00')
})

test('review colors depend only on answer completion, independently of confidence and flags', () => {
  const question = {
    questionId: 0,
    selected: [1],
    selectCount: 2,
    flagged: false,
    confidence: 'Confident',
  } as QuizQuestion
  assert.deepEqual(reviewQuestionIds([question]), [])
  assert.equal(reviewAnswerState(question), 'partial')
  assert.equal(reviewAnswerState({ ...question, selected: [] }), 'unanswered')
  for (const confidence of [null, 'Unsure', 'Educated Guess', 'Confident'] as const) {
    for (const flagged of [true, false]) {
      const answer = { ...question, confidence, flagged }
      assert.equal(reviewAnswerState({ ...answer, selected: [] }), 'unanswered')
      assert.equal(reviewAnswerState(answer), 'partial')
      assert.equal(reviewAnswerState({ ...answer, selected: [1, 2] }), 'answered')
      assert.deepEqual(reviewQuestionIds([answer]), flagged ? [0] : [])
    }
  }
  const flagged = { ...question, selected: [1, 2], flagged: true }
  assert.deepEqual(reviewQuestionIds([flagged]), [0])
  assert.equal(reviewAnswerState(flagged), 'answered')
  assert.deepEqual(reviewQuestionIds([{ ...question, selected: [1, 2] }]), [])
})
