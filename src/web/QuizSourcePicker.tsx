import type { Source } from '../shared/contracts.ts'

type Props = { sources: Source[]; selected: number[]; onChange: (ids: number[]) => void }

export function QuizSourcePicker({ sources, selected, onChange }: Props) {
  return (
    <fieldset className="quiz-source-picker">
      <legend>Question banks</legend>
      <p className="muted">
        Choose one or more banks. Question counts are library totals; the quiz still needs enough
        questions in each exam domain.
      </p>
      <div className="source-picker-actions">
        <button
          type="button"
          disabled={!sources.length}
          onClick={() => onChange(sources.map((s) => s.id))}
        >
          Select all
        </button>
        <button type="button" disabled={!selected.length} onClick={() => onChange([])}>
          Clear
        </button>
        <span>{selected.length} selected</span>
      </div>
      {(['official', 'third_party'] as const).map((kind) => {
        const group = sources.filter((source) => source.kind === kind)
        if (!group.length) return null
        return (
          <div className="source-picker-group" key={kind}>
            <h3>{kind === 'official' ? 'Official' : 'Third-party'}</h3>
            {group.map((source) => (
              <label className="source-picker-option" key={source.id}>
                <input
                  type="checkbox"
                  checked={selected.includes(source.id)}
                  onChange={(event) =>
                    onChange(
                      event.target.checked
                        ? [...selected, source.id]
                        : selected.filter((id) => id !== source.id),
                    )
                  }
                />
                <span>{source.name}</span>
                <small>{source.questionCount} questions</small>
              </label>
            ))}
          </div>
        )
      })}
      {!sources.length && <p>No CLF-C02 question banks are available. Import a bank to begin.</p>}
    </fieldset>
  )
}
