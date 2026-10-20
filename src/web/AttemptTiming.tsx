import type { QuizView } from '../shared/quiz-contracts.ts'
import { formatDuration, quizTiming, timingSummary } from '../shared/quiz-timing.ts'

/** Timing details never score an unfinished attempt or infer missing legacy history. */
export function AttemptTiming({ quiz }: { quiz: QuizView }) {
  const timing = quizTiming(quiz)
  return (
    <section className="attempt-timing" aria-label="Study time">
      <h2>Study time</h2>
      <p>{timingSummary(timing)}</p>
      <small>HH:MM:SS, rounded down to whole seconds.</small>
      {!timing.historyComplete && (
        <p>Earlier pause history was not recorded. Totals are unknown.</p>
      )}
      {timing.pauses.length > 0 && (
        <ol>
          {timing.pauses.map((pause, index) => (
            <li key={index}>
              {pause.cause ?? 'Cause not recorded'} · {new Date(pause.startedAt).toISOString()}
              {' → '}
              {pause.endedAt === null ? 'Ongoing' : new Date(pause.endedAt).toISOString()}
              {' · '}
              {formatDuration(pause.durationMs)}
            </li>
          ))}
        </ol>
      )}
      {quiz.status === 'paused' && (
        <p>Ongoing pause duration as of server time {new Date(quiz.serverNow).toISOString()}.</p>
      )}
    </section>
  )
}
