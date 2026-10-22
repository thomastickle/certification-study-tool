import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  DeletedQuizSummary,
  PracticeMode,
  QuizSummary,
  QuizView,
} from '../shared/quiz-contracts.ts'
import type { Certification } from './certifications.ts'
import { ResultIndicator, ResultLegend } from './ResultIndicator.tsx'
import { StudyIcon } from './StudyIcon.tsx'
import { api } from './api.ts'
import { DeletedBankNotice } from './DeletedBankNotice.tsx'

/** Keeps completion evidence visible while its saved result is pending deletion. */
export function ResultCompletionHeader({ quiz, label }: { quiz: QuizView; label?: string }) {
  const [pending, setPending] = useState<DeletedQuizSummary | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const mode = quiz.mode ?? quiz.options.mode ?? 'quiz'
  const action = pending ? 'Undo deletion' : 'Mark for deletion'

  /** Marks or restores the saved attempt without navigating away from its answer review. */
  async function change(): Promise<void> {
    setBusy(true)
    setError('')
    try {
      if (pending) {
        await api(`/quizzes/${quiz.id}/restore`, { method: 'POST' })
        setPending(null)
      } else {
        const deleted = await api<DeletedQuizSummary | null>(`/quizzes/${quiz.id}`, {
          method: 'DELETE',
        })
        if (!deleted) {
          throw new Error('This result is no longer available.')
        }
        setPending(deleted)
      }
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Could not change this result.'
      // A lost mutation response can still have saved successfully; reconcile before retrying.
      try {
        const query = new URLSearchParams({
          provider: quiz.options.provider ?? 'AWS',
          certification: quiz.options.certification ?? 'CLF-C02',
        })
        const deleted = await api<DeletedQuizSummary[]>(`/quizzes/deleted?${query}`)
        const saved = deleted.find((item) => item.id === quiz.id)
        if (saved) {
          setPending(saved)
        } else {
          await api<QuizView>(`/quizzes/${quiz.id}`)
          setPending(null)
        }
      } catch {
        setError(`${message} Check practice history if the saved status is uncertain.`)
        return
      }
      setError(message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="result-completion-heading">
        <p className="eyebrow">{label ?? `${mode.toUpperCase()} COMPLETE`}</p>
        <button
          className="result-icon-action result-icon-delete"
          aria-label={action}
          title={action}
          aria-busy={busy}
          disabled={busy || (pending !== null && Date.now() >= pending.purgeAt)}
          onClick={() => void change()}
        >
          <StudyIcon name={pending ? 'undo' : 'trash'} />
        </button>
      </div>
      {pending && (
        <p className="deletion-deadline" role="status">
          Will be deleted on{' '}
          <time dateTime={new Date(pending.purgeAt).toISOString()}>
            {new Date(pending.purgeAt).toLocaleString()}
          </time>
        </p>
      )}
      {error && <p role="alert">{error}</p>}
    </>
  )
}

/** Retain pending deletions in their original history, while excluding them from study evidence. */
export function CompletedResults({
  certification,
  mode,
  onOpen,
}: {
  certification: Certification
  mode: PracticeMode
  onOpen: (id: string) => void
}) {
  const [items, setItems] = useState<(QuizSummary | DeletedQuizSummary)[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const revision = useRef(0)
  const request = useRef<AbortController | null>(null)
  const query = new URLSearchParams({
    provider: certification.provider,
    certification: certification.code,
  }).toString()

  /** Read completed and pending snapshots together, rejecting superseded observations. */
  const refresh = useCallback(async () => {
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    const currentRevision = ++revision.current
    try {
      const [completed, deleted] = await Promise.all([
        api<QuizSummary[]>(`/quizzes?${query}`, { signal: controller.signal }),
        api<DeletedQuizSummary[]>(`/quizzes/deleted?${query}`, { signal: controller.signal }),
      ])
      if (!controller.signal.aborted && currentRevision === revision.current) {
        setItems(
          [...completed, ...deleted]
            .filter((item) => (mode === 'review' ? item.mode === 'review' : item.mode !== 'review'))
            .sort((a, b) => b.startedAt - a.startedAt || b.id.localeCompare(a.id)),
        )
      }
    } catch (reason) {
      if (!controller.signal.aborted && currentRevision === revision.current) {
        setError(reason instanceof Error ? reason.message : 'Could not load results.')
      }
    }
  }, [query, mode])

  useEffect(() => {
    void refresh()
    return () => {
      request.current?.abort()
    }
  }, [refresh])

  /** Reconcile both lists even when a mutation response is lost after the server commits. */
  async function change(item: QuizSummary): Promise<void> {
    request.current?.abort()
    revision.current++
    setBusy(item.id)
    setError('')
    try {
      if (item.status === 'deleted') {
        await api(`/quizzes/${item.id}/restore`, { method: 'POST' })
      } else {
        await api(`/quizzes/${item.id}`, { method: 'DELETE' })
      }
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Could not change this result.'
      setError(`${message} Refreshing history to check whether the change was saved.`)
    } finally {
      await refresh()
      setBusy(null)
    }
  }

  const heading = mode === 'review' ? 'Completed due reviews' : 'Completed'
  const plural = mode === 'review' ? 'due reviews' : 'quizzes or exams'
  return (
    <section className="quiz-panel completed-results" aria-label={heading}>
      <div className="section-heading">
        <h2>{heading}</h2>
        <button
          disabled={busy !== null}
          onClick={() => {
            setError('')
            void refresh()
          }}
        >
          Refresh results
        </button>
      </div>
      <ResultLegend />
      {error && <p role="alert">{error}</p>}
      {!items.length && <p className="muted">No completed {plural} yet.</p>}
      <ul className="history-list">
        {items.map((item) => {
          const pending = item.status === 'deleted' && 'purgeAt' in item
          const completedAt = new Date(item.finishedAt ?? item.startedAt)
          let score = 'Score unavailable'
          if (item.total > 0 && item.correctCount !== null) {
            score = `${Math.round((item.correctCount / item.total) * 100)}% score`
          }
          const label = (
            <>
              <time className="completed-result-date" dateTime={completedAt.toISOString()}>
                {completedAt.toLocaleString()}
              </time>
              {' · '}
              <span className="completed-result-score">
                {score} · {item.correctCount ?? '—'}/{item.total} correct
              </span>
            </>
          )
          return (
            <li
              key={item.id}
              data-result-id={item.id}
              className={pending ? 'pending-deletion' : ''}
            >
              <div className="completed-result-summary">
                <ResultIndicator
                  status={item.status}
                  correctCount={item.correctCount}
                  total={item.total}
                />
                <span className="completed-result-content">
                  {mode !== 'review' && (
                    <span className="completed-result-mode">
                      {item.mode === 'exam' ? 'Exam' : 'Quiz'}
                    </span>
                  )}
                  {pending ? (
                    <span className="completed-result-label">{label}</span>
                  ) : (
                    <a
                      className="completed-result-label"
                      href={`#result-${item.id}`}
                      onClick={(event) => {
                        event.preventDefault()
                        onOpen(item.id)
                      }}
                    >
                      {label}
                    </a>
                  )}
                  <DeletedBankNotice names={item.deletedBankNames} compact />
                </span>
              </div>
              <div className="completed-result-actions">
                {pending && (
                  <p className="deletion-deadline">
                    Will be deleted on{' '}
                    <time dateTime={new Date(item.purgeAt).toISOString()}>
                      {new Date(item.purgeAt).toLocaleString()}
                    </time>
                  </p>
                )}
                <button
                  className="result-icon-action result-icon-delete"
                  aria-label={pending ? 'Undo deletion' : 'Delete result'}
                  title={pending ? 'Undo deletion' : 'Delete result'}
                  disabled={busy !== null || (pending && Date.now() >= item.purgeAt)}
                  aria-busy={busy === item.id}
                  onClick={() => void change(item)}
                >
                  <StudyIcon name={pending ? 'undo' : 'trash'} />
                </button>
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
