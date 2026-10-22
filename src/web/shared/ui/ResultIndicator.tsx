import type { QuizSummary } from '../../../shared/quiz-contracts.ts'

const bands = {
  strong: '90–100%',
  middle: '70–89%',
  low: '0–69%',
  paused: 'Paused',
  unknown: 'Score unavailable',
} as const

/** Use exact saved counts so rounded percentages cannot cross a score-band boundary. */
export function ResultIndicator({
  status,
  correctCount,
  total,
}: Pick<QuizSummary, 'status' | 'correctCount' | 'total'>) {
  let band: keyof typeof bands = 'unknown'
  if (status === 'paused') {
    band = 'paused'
  } else if (correctCount !== null && total > 0) {
    const percent = (correctCount / total) * 100
    band = 'low'
    if (percent >= 90) {
      band = 'strong'
    } else if (percent >= 70) {
      band = 'middle'
    }
  }
  return (
    <span
      className={`result-indicator result-indicator-${band}`}
      role="img"
      aria-label={bands[band]}
      title={bands[band]}
    />
  )
}

/** Explain score bands as study feedback, separately from the practice pass target. */
export function ResultLegend() {
  return (
    <ul className="result-legend" aria-label="Result indicator legend">
      {(['strong', 'middle', 'low', 'paused'] as const).map((band) => (
        <li key={band}>
          <span className={`result-indicator result-indicator-${band}`} aria-hidden="true" />
          {bands[band]}
        </li>
      ))}
    </ul>
  )
}
