import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ReportCounts } from '../shared/report-contracts.ts'
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

test('accuracy charts omit unmeasured days instead of inventing zero accuracy', () => {
  const chart = progressChart(
    [
      { date: '2026-10-01', counts: noAnswers, attempts: 1 },
      { date: '2026-10-02', counts: answered, attempts: 1 },
    ],
    'accuracy',
  )
  assert.equal(chart.points.length, 1)
  assert.equal(chart.points[0]!.value, 50)
  assert.equal(chart.points[0]!.x, 360)
  assert.equal(
    progressChart([{ date: '2026-10-01', counts: noAnswers, attempts: 1 }], 'accuracy').points
      .length,
    0,
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
