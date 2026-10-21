import { useEffect, useState } from 'react'
import type { DeletedQuizSummary, PracticeMode } from '../shared/quiz-contracts.ts'
import type { Certification } from './certifications.ts'
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
      <button className="danger" disabled={busy} onClick={() => void remove()}>
        {busy ? 'Deleting…' : 'Delete result'}
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
  useEffect(() => {
    const controller = new AbortController()
    const query = new URLSearchParams({
      provider: certification.provider,
      certification: certification.code,
    })
    setError('')
    api<DeletedQuizSummary[]>(`/quizzes/deleted?${query}`, { signal: controller.signal })
      .then((value) => {
        if (!controller.signal.aborted) {
          setItems(value)
        }
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setError(reason instanceof Error ? reason.message : 'Could not load deleted results.')
        }
      })
    return () => controller.abort()
  }, [certification.provider, certification.code, refresh])

  /** Refreshes recovery and counted history after either mutation, reporting failures inline. */
  async function change(id: string, restore: boolean): Promise<void> {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      if (restore) {
        await api(`/quizzes/${id}/restore`, { method: 'POST' })
      } else {
        await api(`/quizzes/${id}?permanent=true`, { method: 'DELETE' })
      }
      setItems((current) => current.filter((item) => item.id !== id))
      setNotice(
        restore
          ? 'Result restored. Stats and scheduling now include it.'
          : 'Result permanently deleted.',
      )
      onChanged()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not change this result.')
    } finally {
      setBusy(false)
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
        Excluded from all stats and scheduling. Undo within 48 hours, or delete permanently now.
        Permanent deletion cannot be undone.
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
                {item.correctCount}/{item.total} correct · Undo until{' '}
                {new Date(item.purgeAt).toLocaleString()}
              </p>
            </div>
            <div className="actions">
              <button
                disabled={busy || Date.now() >= item.purgeAt}
                onClick={() => void change(item.id, true)}
              >
                Undo deletion
              </button>
              <button
                className="danger"
                disabled={busy}
                onClick={() => void change(item.id, false)}
              >
                Delete permanently
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
