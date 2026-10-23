import { useEffect, useRef } from 'react'
import type { PracticeMode } from '../../../shared/quiz-contracts.ts'

type Props = {
  mode: PracticeMode
  disabled: boolean
  onOpen: () => Promise<boolean>
  onReview: () => void
  onSubmit: () => void
  onAbandon: () => void
}

/** Keep session-wide actions away from the question navigation buttons. */
export function PracticeActions({ mode, disabled, onOpen, onReview, onSubmit, onAbandon }: Props) {
  const menu = useRef<HTMLDetailsElement>(null)
  const opening = useRef(0)

  useEffect(() => {
    function dismiss(event: PointerEvent | KeyboardEvent) {
      if (event instanceof KeyboardEvent && event.key !== 'Escape') return
      if (event instanceof PointerEvent && menu.current?.contains(event.target as Node)) return
      opening.current++
      if (menu.current) menu.current.open = false
    }

    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('keydown', dismiss)
    return () => {
      document.removeEventListener('pointerdown', dismiss)
      document.removeEventListener('keydown', dismiss)
    }
  }, [])

  function choose(action: () => void) {
    if (menu.current) menu.current.open = false
    action()
  }

  return (
    <details className="practice-menu" ref={menu}>
      <summary
        aria-disabled={disabled}
        onClick={(event) => {
          event.preventDefault()
          if (disabled || !menu.current) return
          if (menu.current.open) {
            menu.current.open = false
            return
          }
          const request = ++opening.current
          void onOpen().then((saved) => {
            if (saved && request === opening.current && menu.current) menu.current.open = true
          })
        }}
      >
        Actions <span aria-hidden="true">⌄</span>
      </summary>
      <div className="practice-menu-options">
        <button disabled={disabled} onClick={() => choose(onReview)}>
          Review answers
        </button>
        <button disabled={disabled} onClick={() => choose(onSubmit)}>
          Submit and score
        </button>
        <button className="danger" disabled={disabled} onClick={() => choose(onAbandon)}>
          Abandon {mode}
        </button>
      </div>
    </details>
  )
}
