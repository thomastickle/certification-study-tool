import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ReportCounts } from '../../../shared/report-contracts.ts'
import { progressChart } from './report-state.ts'

const noAnswers: ReportCounts = {
  total: 2,
  answered: 0,
  correct: 0,
  incorrect: 0,
  skipped: 2,
  accuracy: null,
  score: 0,
}
const answered: ReportCounts = {
  total: 2,
  answered: 2,
  correct: 1,
  incorrect: 1,
  skipped: 0,
  accuracy: 50,
  score: 50,
}

test('score charts include all-skipped zeroes and omit days without questions', () => {
  const chart = progressChart(
    [
      {
        date: '2026-09-30',
        counts: { ...noAnswers, total: 0, skipped: 0, score: null },
        attempts: 0,
      },
      { date: '2026-10-01', counts: noAnswers, attempts: 1 },
      { date: '2026-10-02', counts: answered, attempts: 1 },
    ],
    'score',
  )
  assert.equal(chart.points.length, 2)
  assert.deepEqual(
    chart.points.map((point) => point.value),
    [0, 50],
  )
  assert.equal(chart.max, 100)
  assert.equal(
    progressChart([{ date: '2026-10-01', counts: noAnswers, attempts: 1 }], 'score').points.length,
    1,
  )
})

test('correct-answer charts accumulate evidence and space points by elapsed time', () => {
  const chart = progressChart(
    [
      { date: '2026-10-01', counts: answered, attempts: 1 },
      { date: '2026-10-02', counts: answered, attempts: 1 },
      { date: '2026-10-05', counts: answered, attempts: 1 },
    ],
    'correct',
  )
  assert.deepEqual(
    chart.points.map((point) => point.value),
    [1, 2, 3],
  )
  assert.deepEqual(
    chart.points.map((point) => point.x),
    [48, 204, 672],
  )
  assert.equal(chart.max, 3)
  assert.deepEqual(progressChart([], 'correct'), { points: [], max: 1 })
})

test('daily performance plots score while cumulative correct answers remain activity counts', () => {
  const counts = {
    total: 20,
    answered: 8,
    correct: 8,
    incorrect: 0,
    skipped: 12,
    accuracy: 100,
    score: 40,
  }
  const timeline = [{ date: '2026-10-01', counts, attempts: 1 }]
  assert.equal(progressChart(timeline, 'score').points[0]!.value, 40)
  assert.equal(progressChart(timeline, 'correct').points[0]!.value, 8)
})
