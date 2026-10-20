import { useEffect, useState } from 'react'
import type {
  ConceptGroup,
  ConceptMember,
  ConceptScope,
  ConceptSuggestion,
} from '../shared/concept-contracts.ts'
import { api } from './api.ts'

type ScopeLibrary = ConceptScope & { members: ConceptMember[] }

type ReviewData = {
  groups: ConceptGroup[]
  suggestions: ConceptSuggestion[]
  library: ScopeLibrary[]
}

type Editor = ConceptScope & { id?: string; name: string; members: ConceptMember[] }

/** Keep suggestions inactive until the user reviews content and explicitly saves membership. */
export function ConceptPanel({ refreshKey }: { refreshKey: number }) {
  const [data, setData] = useState<ReviewData>({ groups: [], suggestions: [], library: [] })
  const [editor, setEditor] = useState<Editor>()
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const [removing, setRemoving] = useState<string>()

  useEffect(() => {
    const controller = new AbortController()
    api<ReviewData>('/concepts', { signal: controller.signal })
      .then(setData)
      .catch((reason: Error) => {
        if (!controller.signal.aborted) {
          setError(reason.message)
        }
      })
    return () => controller.abort()
  }, [refreshKey, refresh])

  /** Report failures inline and reload only after a successful mutation. */
  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await action()
      setRefresh((value) => value + 1)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The concept change could not be saved.')
    } finally {
      setBusy(false)
    }
  }

  /** Start with a reviewed subset; excluded members remain eligible for later suggestions. */
  function review(value: Editor) {
    setEditor({ ...value, members: [...value.members] })
    setSearch('')
    setNotice('')
  }

  const scope = data.library.find(
    (value) => value.provider === editor?.provider && value.certification === editor?.certification,
  )
  const available =
    scope?.members.filter((member) =>
      member.occurrences.some((record) =>
        [record.data.question, record.reference, record.sourceName, String(record.id)].some(
          (value) => value.toLowerCase().includes(search.toLowerCase()),
        ),
      ),
    ) ?? []

  return (
    <details className="concept-panel">
      <summary>Reviewed concept groups</summary>
      <p>
        Suggestions use the same study area and topic. Matching labels do not prove that questions
        test the same concept. Only groups you explicitly activate affect normal quiz and exam
        variations.
      </p>
      <p>
        Each question keeps its own results and retention checks. Overlapping groups do not join
        other groups together.
      </p>
      {error && (
        <p role="alert" className="message error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="message success">
          {notice}
        </p>
      )}
      <button
        disabled={busy || data.library.length === 0}
        onClick={() => {
          const first = data.library[0]!
          review({
            provider: first.provider,
            certification: first.certification,
            name: '',
            members: [],
          })
        }}
      >
        Create concept group
      </button>
      <h3>Active reviewed groups ({data.groups.length})</h3>
      {data.groups.length === 0 && <p>No reviewed groups yet. Suggestions are inactive.</p>}
      {data.groups.map((group) => (
        <article className="concept-group" key={group.id}>
          <strong>{group.name}</strong>{' '}
          <span>
            {group.provider} · {group.certification} · {group.members.length} available variations
          </span>
          {group.unavailableCount > 0 && (
            <p>
              {group.unavailableCount} reviewed variations are no longer in the library. Saving
              members replaces this group’s membership with your current selection.
            </p>
          )}
          <div className="concept-actions">
            <button disabled={busy} onClick={() => review(group)}>
              Edit group
            </button>
            <button disabled={busy} onClick={() => setRemoving(group.id)}>
              Delete group
            </button>
            {removing === group.id && (
              <>
                <span>Remove this reviewed mapping? Saved results stay intact.</span>
                <button
                  disabled={busy}
                  onClick={() => {
                    void run(async () => {
                      await api(`/concepts/${group.id}`, { method: 'DELETE' })
                      setRemoving(undefined)
                      if (editor?.id === group.id) {
                        setEditor(undefined)
                      }
                      setNotice('Concept group deleted.')
                    })
                  }}
                >
                  Confirm delete group
                </button>
                <button onClick={() => setRemoving(undefined)}>Cancel deletion</button>
              </>
            )}
          </div>
        </article>
      ))}
      <h3>Inactive suggestions ({data.suggestions.length})</h3>
      {data.suggestions.map((suggestion) => (
        <article className="concept-group" key={suggestion.id}>
          <strong>{suggestion.topic}</strong>
          <p>
            {suggestion.provider} · {suggestion.certification} · Same area: {suggestion.area} · Same
            topic: {suggestion.topic} · {suggestion.members.length} variations
          </p>
          <div className="concept-actions">
            <button
              disabled={busy}
              onClick={() =>
                review({
                  provider: suggestion.provider,
                  certification: suggestion.certification,
                  name: suggestion.name,
                  members: suggestion.members,
                })
              }
            >
              Review suggestion
            </button>
            <button
              disabled={busy}
              onClick={() => {
                void run(async () => {
                  await api(`/concept-suggestions/${suggestion.id}/dismiss`, { method: 'POST' })
                  setNotice('Suggestion dismissed. No group was activated.')
                })
              }}
            >
              Dismiss suggestion
            </button>
          </div>
        </article>
      ))}
      {editor && (
        <form
          className="concept-editor"
          onSubmit={(event) => {
            event.preventDefault()
            void run(async () => {
              await api(editor.id ? `/concepts/${editor.id}` : '/concepts', {
                method: editor.id ? 'PUT' : 'POST',
                body: JSON.stringify(editor),
              })
              setEditor(undefined)
              setNotice('Reviewed concept group saved. Excluded questions were not added.')
            })
          }}
        >
          <h3>{editor.id ? 'Edit reviewed group' : 'Review before activating'}</h3>
          <label>
            Certification
            <select
              aria-label="Concept certification"
              disabled={Boolean(editor.id) || busy}
              value={JSON.stringify([editor.provider, editor.certification])}
              onChange={(event) => {
                const [provider, certification] = JSON.parse(event.target.value) as [string, string]
                setEditor({ ...editor, provider, certification, members: [] })
              }}
            >
              {data.library.map((value) => (
                <option
                  key={JSON.stringify([value.provider, value.certification])}
                  value={JSON.stringify([value.provider, value.certification])}
                >
                  {value.provider} · {value.certification}
                </option>
              ))}
            </select>
          </label>
          <label>
            Concept name
            <input
              aria-label="Concept name"
              required
              maxLength={120}
              value={editor.name}
              disabled={busy}
              onChange={(event) => setEditor({ ...editor, name: event.target.value })}
            />
          </label>
          <p>
            Select the questions you reviewed. To split a suggestion, select a subset and give it a
            name; remaining questions stay ungrouped.
          </p>
          <label>
            Find members
            <input
              aria-label="Find concept members"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <p>{editor.members.length} variations selected. Exact copies count once.</p>
          <div className="concept-members">
            {available.map((member) => {
              const question = member.occurrences[0]!
              const selected = editor.members.some(
                (value) => value.reviewToken === member.reviewToken,
              )
              return (
                <article key={member.reviewToken} className="concept-member">
                  <label className="check-label">
                    <input
                      type="checkbox"
                      disabled={busy}
                      aria-label={`Include question ${question.id}`}
                      checked={selected}
                      onChange={() =>
                        setEditor({
                          ...editor,
                          members: selected
                            ? editor.members.filter(
                                (value) => value.reviewToken !== member.reviewToken,
                              )
                            : [...editor.members, member],
                        })
                      }
                    />
                    {question.data.question}
                  </label>
                  <details>
                    <summary>Inspect answers and sources · Library #{question.id}</summary>
                    <p>
                      {question.data.classification?.area ?? 'Unclassified'} ·{' '}
                      {question.data.classification?.topic ?? 'No topic'}
                    </p>
                    <ol>
                      {question.data.answers.map((answer, index) => (
                        <li key={index}>
                          {answer.text}
                          {answer.correct && <strong> · Correct</strong>}
                        </li>
                      ))}
                    </ol>
                    <ul>
                      {member.occurrences.map((record) => (
                        <li key={record.id}>
                          Library #{record.id} · {record.sourceName} ·{' '}
                          {record.reference.startsWith('content:')
                            ? 'No source reference'
                            : record.reference}
                        </li>
                      ))}
                    </ul>
                  </details>
                </article>
              )
            })}
          </div>
          <div className="concept-actions">
            <button
              type="submit"
              className="primary"
              disabled={busy || !editor.name.trim() || editor.members.length === 0}
            >
              {editor.id ? 'Save reviewed group' : 'Activate reviewed group'}
            </button>
            {editor.id && (
              <button
                type="button"
                disabled={busy || !editor.name.trim()}
                onClick={() => {
                  void run(async () => {
                    await api(`/concepts/${editor.id}`, {
                      method: 'PUT',
                      body: JSON.stringify({
                        provider: editor.provider,
                        certification: editor.certification,
                        name: editor.name,
                      }),
                    })
                    setEditor(undefined)
                    setNotice('Concept renamed. Reviewed membership was preserved.')
                  })
                }}
              >
                Rename only
              </button>
            )}
            <button type="button" disabled={busy} onClick={() => setEditor(undefined)}>
              Cancel review
            </button>
          </div>
        </form>
      )}
    </details>
  )
}
