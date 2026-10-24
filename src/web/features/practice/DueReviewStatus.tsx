import { useEffect, useState } from 'react'
import type { DueReviewSummary, QuizOptions } from '../../../shared/quiz-contracts.ts'
import { useApi } from '../../shared/lib/workspace-api.ts'

/** Show outstanding obligations even when filters or library deletion prevent review. */
export function DueReviewStatus({ options }: { options: QuizOptions }) {
  const api = useApi()
  const [summary, setSummary] = useState<DueReviewSummary>()
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setSummary(undefined)
    setError('')
    const query = new URLSearchParams({
      sourceFilter: options.sourceFilter,
      questionType: options.questionType,
    })
    if (options.provider && options.certification) {
      query.set('provider', options.provider)
      query.set('certification', options.certification)
    }
    if (options.sourceIds?.length) {
      query.set('sourceIds', options.sourceIds.join(','))
    }
    api<DueReviewSummary>(`/quizzes/due?${query}`, { signal: controller.signal })
      .then((value) => {
        if (!controller.signal.aborted) {
          setSummary(value)
        }
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setError(reason instanceof Error ? reason.message : 'Could not load due checks.')
        }
      })
    return () => controller.abort()
  }, [options, refresh])
  return (
    <section className="quiz-panel" aria-label="Due retention checks">
      <h2>Due retention checks</h2>
      <p>Study days use America/New_York. Only correct + Confident passes a due check.</p>
      {summary && (
        <>
          <p>
            <strong>{summary.total} due</strong>
            {summary.oldestDay ? ` · oldest due ${summary.oldestDay}` : ''}
          </p>
          {options.sourceIds?.length ? (
            <p>
              {summary.eligible} eligible · {summary.excluded} excluded by filters ·{' '}
              {summary.unavailable} unavailable in the library
            </p>
          ) : (
            <p>
              Select banks to review. {summary.unavailable} due questions are unavailable in the
              library.
            </p>
          )}
          {summary.total > 0 && (!options.sourceIds?.length || summary.eligible === 0) && (
            <p>
              No eligible items can be reviewed with this selection. Excluded and unavailable items
              remain overdue.
            </p>
          )}
        </>
      )}
      {!summary && !error && <p role="status">Checking due questions…</p>}
      {error && <p role="alert">{error}</p>}
      <p>
        Sessions contain up to 20 due questions with a 20-minute timer. Pause, resume, or abandon as
        usual. Reviews have no exam pass target and do not change quiz/exam domain quotas.
      </p>
      <button onClick={() => setRefresh((value) => value + 1)}>Refresh due checks</button>
    </section>
  )
}
