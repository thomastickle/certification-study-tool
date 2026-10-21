import { useEffect, useRef, useState } from 'react'
import type { DeletedQuizSummary, PracticeMode } from '../shared/quiz-contracts.ts'
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

/** Keeps undo available across reloads, separately from counted practice history. */
export function DeletedResults({
  certification,
  mode,
  onChanged,
}: {
  certification: Certification
  mode?: PracticeMode
  onChanged: () => void
}) {
  const [items, setItems] = useState<DeletedQuizSummary[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [refresh, setRefresh] = useState(0)
  const readRevision = useRef(0)
  useEffect(() => {
    const controller = new AbortController()
    const revision = ++readRevision.current
    const query = new URLSearchParams({
      provider: certification.provider,
      certification: certification.code,
    })
    api<DeletedQuizSummary[]>(`/quizzes/deleted?${query}`, { signal: controller.signal })
      .then((value) => {
        if (!controller.signal.aborted && revision === readRevision.current) {
          setItems(value)
        }
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted && revision === readRevision.current) {
          setError(reason instanceof Error ? reason.message : 'Could not load deleted results.')
        }
      })
    return () => controller.abort()
  }, [certification.provider, certification.code, refresh])

  /** Refreshes recovery and counted history after restoration, reporting failures inline. */
  async function restore(id: string): Promise<void> {
    readRevision.current++
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await api(`/quizzes/${id}/restore`, { method: 'POST' })
      setItems((current) => current.filter((item) => item.id !== id))
      setNotice('Result restored. Stats and scheduling now include it.')
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Could not change this result.'
      setError(`${message} Refreshing history to check whether the change was saved.`)
    } finally {
      setBusy(false)
      setRefresh((value) => value + 1)
      onChanged()
    }
  }

  const visible = items.filter((item) => !mode || (item.mode ?? 'quiz') === mode)
  return (
    <section className="quiz-panel deleted-results" aria-label="Recently deleted results">
      <div className="section-heading">
        <h2>Recently deleted results</h2>
        <button disabled={busy} onClick={() => setRefresh((value) => value + 1)}>
          Refresh deleted results
        </button>
      </div>
      <p>
        Excluded from all stats and scheduling. Undo within 48 hours. After that, results are
        permanently deleted automatically.
      </p>
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert">{error}</p>}
      {!visible.length && <p className="muted">No results pending deletion.</p>}
      <ul className="history-list">
        {visible.map((item) => (
          <li key={item.id}>
            <div>
              <strong>
                {(item.mode ?? 'quiz').toUpperCase()} ·{' '}
                {new Date(item.finishedAt ?? item.startedAt).toLocaleString()}
              </strong>
              <p>
                {item.correctCount}/{item.total} correct
              </p>
              <p className="deletion-deadline">
                Will be deleted on{' '}
                <time dateTime={new Date(item.purgeAt).toISOString()}>
                  {new Date(item.purgeAt).toLocaleString()}
                </time>
              </p>
            </div>
            <div className="actions">
              <button
                className="result-icon-action"
                aria-label="Undo deletion"
                title="Undo deletion"
                aria-busy={busy}
                disabled={busy || Date.now() >= item.purgeAt}
                onClick={() => void restore(item.id)}
              >
                <StudyIcon name="undo" />
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
