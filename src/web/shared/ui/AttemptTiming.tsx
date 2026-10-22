import type { QuizView } from '../../../shared/quiz-contracts.ts'
import { quizTiming } from '../../../shared/quiz-timing.ts'

/** Uses explicit units so compact durations need no format legend. */
function duration(ms: number | null): string {
  if (ms === null) {
    return '—'
  }
  const seconds = Math.floor(Math.max(0, ms) / 1000)
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const parts = []
  if (hours > 0) {
    parts.push(`${hours}h`)
  }
  if (minutes > 0) {
    parts.push(`${minutes}m`)
  }
  if (seconds % 60 > 0 || parts.length === 0) {
    parts.push(`${seconds % 60}s`)
  }
  return parts.join(' ')
}

/** Shows saved timing totals without inferring missing legacy pause history. */
export function AttemptTiming({ quiz }: { quiz: QuizView }) {
  const timing = quizTiming(quiz)
  return (
    <section className="attempt-timing" aria-label="Study time">
      <dl>
        <div title="From start to finish, including pauses">
          <dt>Total time</dt>
          <dd>{duration(timing.elapsedMs)}</dd>
        </div>
        <div title="Total time minus pauses">
          <dt>Time in test</dt>
          <dd>{duration(timing.activeMs)}</dd>
        </div>
        <div>
          <dt>Pauses</dt>
          <dd>{timing.pauseCount ?? '—'}</dd>
        </div>
        <div>
          <dt>Pause time</dt>
          <dd>{duration(timing.pausedMs)}</dd>
        </div>
      </dl>
    </section>
  )
}
