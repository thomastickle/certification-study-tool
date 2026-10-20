import type { StudyReport } from '../shared/report-contracts.ts'

export type ProgressMetric = 'correct' | 'score'

/** Computes chart positions from UTC activity dates and preserves a single measured point. */
export function progressChart(timeline: StudyReport['timeline'], metric: ProgressMetric) {
  let cumulative = 0
  const measured = timeline.filter((day) => metric === 'correct' || day.counts.score !== null)
  const values = measured.map((day) => {
    cumulative += day.counts.correct
    return { ...day, value: metric === 'correct' ? cumulative : (day.counts.score ?? 0) }
  })
  const max = metric === 'score' ? 100 : Math.max(1, ...values.map((day) => day.value))
  const first = new Date(values[0]?.date ?? 0).getTime()
  const last = new Date(values.at(-1)?.date ?? 0).getTime()
  const points = values.map((day) => ({
    ...day,
    x:
      values.length === 1
        ? 360
        : 48 + ((new Date(day.date).getTime() - first) / (last - first || 1)) * 624,
    y: 180 - (day.value / max) * 145,
  }))
  return { points, max }
}
