import { useCallback, useEffect, useRef, useState } from 'react'
import type { DeletedQuizSummary, PracticeMode, QuizSummary } from '../shared/quiz-contracts.ts'
import type { Certification } from './certifications.ts'
import { StudyIcon } from './StudyIcon.tsx'
import { api } from './api.ts'

/** Deletes immediately without confirmation; the recovery list owns undo. */
export function DeleteResultButton({ id, onDeleted }: { id: string; onDeleted: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  /** Retains the result on failure and allows retry after a lost response. */
  async function remove(): Promise<void> {
    setBusy(true)
    setError('')
    try {
      await api(`/quizzes/${id}`, { method: 'DELETE' })
      onDeleted()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not delete this result.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="result-deletion">
      <button
        className="danger result-icon-action"
        aria-label="Delete result"
        title="Delete result"
        aria-busy={busy}
        disabled={busy}
        onClick={() => void remove()}
      >
        <StudyIcon name="trash" />
      </button>
      <p>Removes this attempt from stats and scheduling immediately. Undo within 48 hours.</p>
      {error && <p role="alert">{error}</p>}
    </div>
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
  const [notice, setNotice] = useState('')
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
            .filter((item) => (item.mode ?? 'quiz') === mode)
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
    setNotice('')
    try {
      if (item.status === 'deleted') {
        await api(`/quizzes/${item.id}/restore`, { method: 'POST' })
        setNotice('Result restored. Stats and scheduling now include it.')
      } else {
        await api(`/quizzes/${item.id}`, { method: 'DELETE' })
        setNotice('Result marked for deletion. Stats and scheduling now exclude it.')
      }
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Could not change this result.'
      setError(`${message} Refreshing history to check whether the change was saved.`)
    } finally {
      await refresh()
      setBusy(null)
    }
  }

  let plural = mode === 'exam' ? 'exams' : 'quizzes'
  if (mode === 'review') {
    plural = 'due reviews'
  }
  return (
    <section className="quiz-panel completed-results" aria-label={`Completed ${plural}`}>
      <div className="section-heading">
        <h2>Completed {plural}</h2>
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
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {!items.length && <p className="muted">No completed {plural} yet.</p>}
      <ul className="history-list">
        {items.map((item) => {
          const pending = item.status === 'deleted' && 'purgeAt' in item
          const label = `${new Date(item.finishedAt ?? item.startedAt).toLocaleString()} · ${item.correctCount ?? 0}/${item.total}`
          return (
            <li
              key={item.id}
              data-result-id={item.id}
              className={pending ? 'pending-deletion' : ''}
            >
              <div>
                {pending ? (
                  <span>{label}</span>
                ) : (
                  <a
                    href={`#result-${item.id}`}
                    onClick={(event) => {
                      event.preventDefault()
                      onOpen(item.id)
                    }}
                  >
                    {label}
                  </a>
                )}
                {pending && (
                  <p className="deletion-deadline">
                    Will be deleted on{' '}
                    <time dateTime={new Date(item.purgeAt).toISOString()}>
                      {new Date(item.purgeAt).toLocaleString()}
                    </time>
                  </p>
                )}
              </div>
              <button
                className={`result-icon-action ${pending ? '' : 'danger'}`}
                aria-label={pending ? 'Undo deletion' : 'Delete result'}
                title={pending ? 'Undo deletion' : 'Delete result'}
                disabled={busy !== null || (pending && Date.now() >= item.purgeAt)}
                aria-busy={busy === item.id}
                onClick={() => void change(item)}
              >
                <StudyIcon name={pending ? 'undo' : 'trash'} />
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
