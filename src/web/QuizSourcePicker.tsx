import { useEffect, useId, useRef, useState } from 'react'
import type { Source } from '../shared/contracts.ts'

type Props = { sources: Source[]; selected: number[]; onChange: (ids: number[]) => void }

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

  const summary = selected.length
    ? `${selected.length} ${selected.length === 1 ? 'bank' : 'banks'} selected`
    : 'Choose question banks'
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
        <span>{summary}</span>
        <span aria-hidden="true">⌄</span>
      </button>
      {!sources.length && <p className="muted">Import a CLF-C02 question bank to begin.</p>}
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
                  <span>{source.name}</span>
                  <small>{source.questionCount} questions</small>
                </label>
              ))}
            </div>
          )
        })}
        <p className="muted">
          Counts show bank totals. Your selection still needs enough questions in each exam domain.
        </p>
      </dialog>
    </fieldset>
  )
}
