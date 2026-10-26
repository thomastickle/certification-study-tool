import { useEffect, useId, useRef, useState } from 'react'
import type { LibraryItemId, Source } from '../../../shared/contracts.ts'

type Props = {
  sources: Source[]
  selected: LibraryItemId[]
  onChange: (ids: LibraryItemId[]) => void
}

export function QuizSourcePicker({ sources, selected, onChange }: Props) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLFieldSetElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  const restoreFocus = useRef(true)

  function close() {
    dialog.current?.close()
  }

  useEffect(() => {
    const panel = dialog.current
    if (!panel || !open) return
    const mobile = window.matchMedia('(max-width: 600px)')
    const previousOverflow = document.body.style.overflow
    if (mobile.matches) {
      document.body.style.overflow = 'hidden'
      panel.showModal()
    } else panel.show()

    const outside = (event: Event) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) {
        restoreFocus.current = false
        panel.close()
      }
    }

    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        panel.close()
      }
    }

    // Reopen from the trigger after switching between desktop and mobile modes.
    const resize = () => panel.close()

    document.addEventListener('pointerdown', outside)
    document.addEventListener('focusin', outside)
    document.addEventListener('keydown', escape)
    mobile.addEventListener('change', resize)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('focusin', outside)
      document.removeEventListener('keydown', escape)
      mobile.removeEventListener('change', resize)
    }
  }, [open])

  const selectedGroups = (['official', 'third_party'] as const).flatMap((kind) => {
    const banks = sources.filter((source) => source.kind === kind && selected.includes(source.id))
    if (!banks.length) {
      return []
    }
    const label = kind === 'official' ? 'Official' : 'Third-party'
    const count = banks.reduce((total, source) => total + source.questionCount, 0)
    return [
      {
        kind,
        summary: `${label} · ${banks.length} ${banks.length === 1 ? 'bank' : 'banks'} · ${count} ${count === 1 ? 'question' : 'questions'}`,
      },
    ]
  })
  return (
    <fieldset className="quiz-source-picker" ref={root}>
      <legend>Question banks</legend>
      <button
        className="source-picker-trigger"
        ref={trigger}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={`${id}-panel`}
        disabled={!sources.length}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <span className="source-picker-summary">
          {selectedGroups.length
            ? selectedGroups.map((group) => <span key={group.kind}>{group.summary}</span>)
            : 'Choose question banks'}
        </span>
        <span aria-hidden="true">⌄</span>
      </button>
      {!sources.length && (
        <p className="muted">Import a question bank for this certification to begin.</p>
      )}
      <dialog
        className="source-picker-popover"
        ref={dialog}
        id={`${id}-panel`}
        aria-labelledby={`${id}-title`}
        onClose={() => {
          setOpen(false)
          if (restoreFocus.current) trigger.current?.focus()
          restoreFocus.current = true
        }}
        onClick={(event) => {
          if (event.target !== event.currentTarget) return
          const bounds = event.currentTarget.getBoundingClientRect()
          if (
            event.clientX < bounds.left ||
            event.clientX > bounds.right ||
            event.clientY < bounds.top ||
            event.clientY > bounds.bottom
          )
            close()
        }}
      >
        <div className="source-picker-heading">
          <h2 id={`${id}-title`}>Question banks</h2>
          <button type="button" onClick={close}>
            Done
          </button>
        </div>
        <p className="muted">Choose one or more banks. Selections apply immediately.</p>
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
          <span aria-live="polite">{selected.length} selected</span>
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
                          : selected.filter((value) => value !== source.id),
                      )
                    }
                  />
                  <span>
                    {source.name} · {source.visibility === 'private' ? 'Private' : 'Shared'}
                  </span>
                  <small>{source.questionCount} questions</small>
                </label>
              ))}
            </div>
          )
        })}
        <p className="muted">
          Counts show bank totals. Your selection still needs enough unique eligible questions.
        </p>
      </dialog>
    </fieldset>
  )
}
