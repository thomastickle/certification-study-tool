import { useEffect, useRef, useState } from 'react'
import type {
  JsonObject,
  Preview,
  Question,
  QuestionPage,
  Source,
  StoredQuestion,
} from '../../../shared/contracts.ts'
import { api } from '../../shared/lib/api.ts'
import { ConceptPanel } from './ConceptPanel.tsx'

type Removal = { kind: 'sources' | 'questions'; id: number; name: string; count?: number }

const emptyPage: QuestionPage = { items: [], total: 0, page: 1, pageSize: 25 }

export function LibraryPage({ onLibraryChange }: { onLibraryChange?: () => Promise<void> }) {
  const [sources, setSources] = useState<Source[]>([])
  const [questions, setQuestions] = useState<QuestionPage>(emptyPage)
  const [sourceId, setSourceId] = useState<number>()
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [refresh, setRefresh] = useState(0)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [importOpen, setImportOpen] = useState(false)
  const [fileName, setFileName] = useState('')
  const [bank, setBank] = useState<unknown>()
  const [preview, setPreview] = useState<Preview>()
  const [reviewed, setReviewed] = useState(false)
  const [removal, setRemoval] = useState<Removal>()
  const dialog = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const query = new URLSearchParams({ search, page: String(page) })
    if (sourceId) query.set('sourceId', String(sourceId))
    Promise.all([api<Source[]>('/sources'), api<QuestionPage>('/questions?' + query)])
      .then(([nextSources, nextQuestions]) => {
        if (!cancelled) {
          setSources(nextSources)
          setQuestions(nextQuestions)
        }
      })
      .catch((reason) => {
        if (!cancelled) setError(String(reason.message))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [sourceId, search, page, refresh])

  useEffect(() => {
    if (removal) dialog.current?.showModal()
    else dialog.current?.close()
  }, [removal])

  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await action()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The operation failed.')
    } finally {
      setBusy(false)
    }
  }

  async function chooseFile(file: File | undefined) {
    if (!file) return
    setFileName(file.name)
    setBank(undefined)
    setPreview(undefined)
    setReviewed(false)
    await run(async () => {
      if (file.size > 10 * 1024 * 1024) throw new Error('Choose a JSON file smaller than 10 MB.')
      let input: unknown
      try {
        input = JSON.parse(await file.text())
      } catch {
        throw new Error('This file is not valid JSON. Nothing was imported.')
      }
      setBank(input)
      const next = await api<Preview>('/imports/preview', {
        method: 'POST',
        body: JSON.stringify({ bank: input }),
      })
      setPreview(next)
    })
  }

  async function confirmImport() {
    if (!preview) return
    await run(async () => {
      const result = await api<Preview>('/imports/confirm', {
        method: 'POST',
        body: JSON.stringify({ bank, token: preview.token, reviewed }),
      })
      setNotice(
        `Imported ${result.added} new and updated ${result.changed.length} questions. Skipped ${result.unchanged} unchanged.`,
      )
      setPreview(undefined)
      setBank(undefined)
      setFileName('')
      setReviewed(false)
      setRefresh((n) => n + 1)
      setPage(1)
      await onLibraryChange?.()
    })
  }

  async function confirmRemoval() {
    if (!removal) return
    await run(async () => {
      await api(`/${removal.kind}/${removal.id}`, { method: 'DELETE' })
      if (removal.kind === 'sources' && removal.id === sourceId) setSourceId(undefined)
      setNotice(
        removal.kind === 'sources' ? 'Source and its questions deleted.' : 'Question deleted.',
      )
      setRemoval(undefined)
      setPreview(undefined)
      setRefresh((n) => n + 1)
      setPage(1)
      await onLibraryChange?.()
    })
  }

  const selectedSource = sources.find((s) => s.id === sourceId)
  const total = sources.reduce((sum, source) => sum + source.questionCount, 0)
  const needsReview = Boolean(preview?.changed.length || preview?.metadataChange)
  const hasChanges = Boolean(
    preview && (preview.added || preview.changed.length || preview.metadataChange),
  )

  return (
    <>
      <main className="library-page">
        <div className="page-heading">
          <div>
            <h1>Question library</h1>
            <p className="intro">Browse sources and import question banks.</p>
          </div>
          <button
            className="primary"
            onClick={() => setImportOpen((open) => !open)}
            aria-expanded={importOpen}
          >
            {importOpen ? 'Close import' : '+ Import a bank'}
          </button>
        </div>
        {error && (
          <div className="message error" role="alert">
            <strong>Couldn’t complete that action</strong>
            <pre>{error}</pre>
            <button onClick={() => setError('')}>Dismiss</button>
          </div>
        )}
        {notice && (
          <div className="message success" role="status">
            {notice}
          </div>
        )}
        {importOpen && (
          <section className="import-panel" aria-label="Import question bank">
            <div className="section-heading">
              <div>
                <p className="eyebrow">ADD TO YOUR LIBRARY</p>
                <h2>Import a question bank</h2>
              </div>
              <span className="step-label">Preview before saving</span>
            </div>
            <p>Choose a version 2 JSON bank. It is sent only to this computer’s local server.</p>
            <div className="file-row">
              <label className={`file-button ${busy ? 'disabled' : ''}`}>
                Choose JSON file
                <input
                  type="file"
                  accept=".json,application/json"
                  disabled={busy}
                  onChange={(event) => {
                    void chooseFile(event.target.files?.[0])
                    event.target.value = ''
                  }}
                />
              </label>
              <span>{fileName || 'No file selected'}</span>
              {busy && <span role="status">Working…</span>}
            </div>
            {preview && (
              <div className="preview">
                <h3>
                  {preview.sourceName}{' '}
                  <span className="tag">
                    {preview.sourceKind === 'official' ? 'Official source' : 'Third-party source'}
                  </span>
                </h3>
                <p className="muted">
                  {preview.certification} · {preview.total} questions in this file
                </p>
                <div className="preview-counts">
                  <div>
                    <strong>{preview.added}</strong>
                    <span>New</span>
                  </div>
                  <div>
                    <strong>{preview.unchanged}</strong>
                    <span>Unchanged · skipped</span>
                  </div>
                  <div>
                    <strong>{preview.changed.length}</strong>
                    <span>Changed · review needed</span>
                  </div>
                </div>
                {preview.duplicateCount > 0 && (
                  <p className="warning">
                    {preview.duplicateCount} questions match another occurrence. Each source is kept
                    separately.
                  </p>
                )}
                {preview.unclassified.length > 0 && (
                  <details>
                    <summary>
                      {preview.unclassified.length} questions need a study area/topic
                    </summary>
                    <p>{preview.unclassified.join(', ')}</p>
                  </details>
                )}
                {preview.conflicts.length > 0 && (
                  <p className="warning" role="alert">
                    Conflicting answer keys for references {preview.conflicts.join(', ')}. Correct
                    the file and preview it again before importing.
                  </p>
                )}
                {preview.metadataChange && (
                  <details>
                    <summary>Review changed source metadata</summary>
                    <Comparison
                      before={preview.metadataChange.before}
                      after={preview.metadataChange.after}
                    />
                  </details>
                )}
                {preview.changed.map((change) => (
                  <details key={change.reference}>
                    <summary>Review changed question {change.reference}</summary>
                    <Comparison before={change.before} after={change.after} />
                  </details>
                ))}
                {needsReview && (
                  <label className="check-label">
                    <input
                      type="checkbox"
                      checked={reviewed}
                      onChange={(event) => setReviewed(event.target.checked)}
                    />{' '}
                    I reviewed and approve all changed questions and source metadata.
                  </label>
                )}
                <div className="preview-actions">
                  <button
                    className="primary"
                    disabled={
                      busy ||
                      !hasChanges ||
                      (needsReview && !reviewed) ||
                      preview.conflicts.length > 0
                    }
                    onClick={() => {
                      void confirmImport()
                    }}
                  >
                    {hasChanges ? 'Confirm import' : 'Nothing new to import'}
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => {
                      void run(async () => {
                        setReviewed(false)
                        setPreview(
                          await api<Preview>('/imports/preview', {
                            method: 'POST',
                            body: JSON.stringify({ bank }),
                          }),
                        )
                      })
                    }}
                  >
                    Refresh preview
                  </button>
                </div>
              </div>
            )}
          </section>
        )}
        <ConceptPanel refreshKey={refresh} />
        <div className="library-layout">
          <aside className="source-panel" aria-label="Question sources">
            <div className="source-heading">
              <h2>Sources</h2>
              <span>{sources.length}</span>
            </div>
            <button
              className={`source-option ${sourceId === undefined ? 'selected' : ''}`}
              onClick={() => {
                setSourceId(undefined)
                setPage(1)
              }}
            >
              <span>All questions</span>
              <strong>{total}</strong>
            </button>
            {sources.map((source) => (
              <button
                key={source.id}
                className={`source-option ${sourceId === source.id ? 'selected' : ''}`}
                onClick={() => {
                  setSourceId(source.id)
                  setPage(1)
                }}
              >
                <span>
                  {source.name}
                  <small>
                    {source.certification} ·{' '}
                    {source.kind === 'official' ? 'Official' : 'Third-party'}
                  </small>
                </span>
                <strong>{source.questionCount}</strong>
              </button>
            ))}
            <div className="privacy-note">
              <strong>Your library stays here.</strong>
              <p>
                The database lives on this computer. Importing doesn’t send your questions to an
                external service.
              </p>
            </div>
          </aside>
          <section className="questions-panel" aria-label="Stored questions">
            <div className="section-heading">
              <div>
                <p className="eyebrow">{selectedSource?.certification ?? 'LIBRARY'}</p>
                <h2>{selectedSource?.name ?? 'All questions'}</h2>
              </div>
              {selectedSource && (
                <button
                  className="danger subtle"
                  disabled={busy || loading}
                  onClick={() =>
                    setRemoval({
                      kind: 'sources',
                      id: selectedSource.id,
                      name: selectedSource.name,
                      count: selectedSource.questionCount,
                    })
                  }
                >
                  Delete source
                </button>
              )}
            </div>
            {selectedSource && (
              <p className="source-identity">
                {selectedSource.provider} · Source key: {selectedSource.key}
              </p>
            )}
            <div className="list-tools">
              <label className="search">
                <span aria-hidden="true">⌕</span>
                <input
                  aria-label="Search questions"
                  type="search"
                  placeholder="Search questions, areas, or topics…"
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value)
                    setPage(1)
                  }}
                />
              </label>
              <span className="result-count">
                {loading
                  ? 'Loading…'
                  : `${questions.total} ${questions.total === 1 ? 'question' : 'questions'}`}
              </span>
            </div>
            {loading ? (
              <div className="empty-state" role="status">
                Opening your library…
              </div>
            ) : questions.items.length === 0 ? (
              <div className="empty-state">
                <span className="empty-symbol" aria-hidden="true">
                  ≡
                </span>
                <h3>
                  {total === 0 ? 'Your library starts with a question.' : 'No matching questions.'}
                </h3>
                <p>
                  {total === 0
                    ? 'Import your first bank to see its questions and sources here.'
                    : 'Try another search or choose a different source.'}
                </p>
                {total === 0 && (
                  <button onClick={() => setImportOpen(true)}>Import your first bank</button>
                )}
              </div>
            ) : (
              <div className="question-list">
                {questions.items.map((question) => (
                  <QuestionCard
                    key={question.id}
                    question={question}
                    disabled={busy}
                    onDelete={() =>
                      setRemoval({
                        kind: 'questions',
                        id: question.id,
                        name: question.data.question,
                      })
                    }
                  />
                ))}
              </div>
            )}
            {questions.total > questions.pageSize && (
              <nav className="pagination" aria-label="Question pages">
                <button disabled={loading || page === 1} onClick={() => setPage((p) => p - 1)}>
                  Previous
                </button>
                <span>
                  Page {page} of {Math.ceil(questions.total / questions.pageSize)}
                </span>
                <button
                  disabled={loading || page * questions.pageSize >= questions.total}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </button>
              </nav>
            )}
          </section>
        </div>
        <footer>
          Certification Study Tool <span>Start small. Learn deliberately.</span>
        </footer>
      </main>
      <dialog
        ref={dialog}
        onCancel={(event) => {
          if (busy) event.preventDefault()
          else setRemoval(undefined)
        }}
        onClose={() => {
          if (!busy) setRemoval(undefined)
        }}
        aria-labelledby="delete-title"
      >
        <h2 id="delete-title">
          {removal?.kind === 'sources' ? 'Delete this source?' : 'Delete this question?'}
        </h2>
        <p className="delete-name">{removal?.name}</p>
        <p>
          {removal?.kind === 'sources'
            ? `This removes the source and its ${removal.count} questions from this database.`
            : 'This removes only this source’s copy of the question.'}{' '}
          Your original JSON files stay untouched. This cannot be undone here.
        </p>
        {removal?.kind === 'sources' && (
          <p>
            Saved quizzes, exams, and reports stay available. Attempts that used this bank will show
            a “Contains obsolete / deleted questions” indicator, even after reimport. Their scores
            still count.
          </p>
        )}
        <div className="dialog-actions">
          <button disabled={busy} onClick={() => setRemoval(undefined)} autoFocus>
            Cancel
          </button>
          <button
            className="danger"
            disabled={busy}
            onClick={() => {
              void confirmRemoval()
            }}
          >
            Delete {removal?.kind === 'sources' ? 'source' : 'question'}
          </button>
        </div>
      </dialog>
    </>
  )
}

function Comparison({ before, after }: { before: JsonObject; after: JsonObject }) {
  return (
    <div className="comparison">
      <div>
        <h4>Stored version</h4>
        <pre>{JSON.stringify(before, null, 2)}</pre>
      </div>
      <div>
        <h4>Incoming version</h4>
        <pre>{JSON.stringify(after, null, 2)}</pre>
      </div>
    </div>
  )
}

function QuestionCard({
  question,
  disabled,
  onDelete,
}: {
  question: StoredQuestion
  disabled: boolean
  onDelete: () => void
}) {
  const q: Question = question.data
  return (
    <article className="question-card">
      <div className="question-meta">
        <span>{q.classification?.area ?? 'Unclassified'}</span>
        <span>{q.classification?.topic ?? 'Topic not assigned'}</span>
      </div>
      <details>
        <summary>
          <span className="question-ref">
            {question.reference.startsWith('content:') ? 'No source reference' : question.reference}
          </span>
          <span>{q.question}</span>
        </summary>
        <p className="muted">
          {q.type === 'multi_select' ? `Select ${q.select_count} answers` : 'Select one answer'}
        </p>
        <ol className="answers" type="A">
          {q.answers.map((answer, index) => (
            <li key={index} className={answer.correct ? 'correct' : ''}>
              {answer.text}
              {answer.correct && <span className="answer-label">Correct</span>}
              {answer.rationale && <p>{answer.rationale}</p>}
            </li>
          ))}
        </ol>
        {typeof q.explanation === 'string' && (
          <div className="explanation">
            <strong>Source explanation</strong>
            <p>{q.explanation}</p>
          </div>
        )}
        <details className="raw-data">
          <summary>View full source record</summary>
          <pre>{JSON.stringify(q, null, 2)}</pre>
        </details>
      </details>
      <div className="question-bottom">
        <span>{question.sourceName}</span>
        <button className="danger subtle" disabled={disabled} onClick={onDelete}>
          Delete question
        </button>
      </div>
    </article>
  )
}
