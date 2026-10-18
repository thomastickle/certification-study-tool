import test from 'node:test';
import assert from 'node:assert/strict';
import { meetsPracticeTarget, reviewQuestionIds, warningThreshold } from './quiz-state.ts';
import type { QuizQuestion } from '../shared/quiz-contracts.ts';

test('warning threshold follows server deadline, including crossed thresholds', () => {
  assert.equal(warningThreshold(10 * 60_000 - 1), '10-minute');
  assert.equal(warningThreshold(2 * 60_000 - 1), '2-minute');
  assert.equal(warningThreshold(0), '2-minute');
  assert.equal(warningThreshold(10 * 60_000), '10-minute');
  assert.equal(warningThreshold(2 * 60_000), '2-minute');
  assert.equal(warningThreshold(10 * 60_000 + 1), null);
});

test('review list includes unanswered, flagged, low confidence, and unrecorded confidence', () => {
  const questions = [
    { questionId: 1, selected: [], confidence: null, flagged: false },
    { questionId: 2, selected: [1], confidence: 'Confident', flagged: true },
    { questionId: 3, selected: [1], confidence: 'Unsure', flagged: false },
    { questionId: 4, selected: [1], confidence: 'Educated Guess', flagged: false },
    { questionId: 5, selected: [1], confidence: 'Confident', flagged: false },
  ] as QuizQuestion[];
  assert.deepEqual(reviewQuestionIds(questions), [1, 2, 3, 4]);
});

test('80 percent practice target passes at the boundary only', () => {
  assert.equal(meetsPracticeTarget(79), false);
  assert.equal(meetsPracticeTarget(80), true);
  assert.equal(meetsPracticeTarget(100), true);
});
