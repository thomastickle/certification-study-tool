import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { certificationKey, filterCertifications } from './certifications.ts'
import type { Certification } from './certifications.ts'
import './certification-picker.css'

type Props = {
  certifications: Certification[]
  selected: Certification | null
  onSelect: (cert: Certification) => void | Promise<void>
  disabled?: boolean
  loading?: boolean
}

const levels = ['Foundational', 'Fundamentals', 'Associate', 'Professional', 'Expert', 'Specialty']

/** Orders the visible rows once for both rendering and keyboard navigation. */
function orderedCertifications(certifications: Certification[]): Certification[] {
  return [...certifications].sort((left, right) => {
    const groupOrder =
      left.organization.localeCompare(right.organization) ||
      left.platform.localeCompare(right.platform)
    const leftLevel = left.level ? levels.indexOf(left.level) : levels.length
    const rightLevel = right.level ? levels.indexOf(right.level) : levels.length
    return (
      groupOrder ||
      leftLevel - rightLevel ||
      (left.level ?? '').localeCompare(right.level ?? '') ||
      left.name.localeCompare(right.name) ||
      certificationKey(left).localeCompare(certificationKey(right))
    )
  })
}

/** Offers a searchable, keyboard-accessible certification selector. */
export function CertificationPicker({
  certifications,
  selected,
  onSelect,
  disabled = false,
  loading = false,
}: Props) {
  const id = useId()
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([])
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(-1)
  const [pending, setPending] = useState(false)

  const visible = useMemo(
    () => orderedCertifications(filterCertifications(certifications, query)),
    [certifications, query],
  )

  useEffect(() => {
    if (open) {
      search.current?.focus()
    }
  }, [open])

  useEffect(() => {
    if (activeIndex >= 0) {
      optionRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest' })
    }
  }, [activeIndex, visible, open])

  useEffect(() => {
    if (!open) {
      return
    }

    /** Dismisses the picker when the pointer leaves its controls. */
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) {
        setOpen(false)
      }
    }

    /** Restores trigger focus when Escape dismisses the picker. */
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setOpen(false)
        trigger.current?.focus()
      }
    }

    document.addEventListener('pointerdown', closeOnOutsidePointer)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  /** Closes the popup and restores the trigger after selection or Escape. */
  function close() {
    setOpen(false)
    setQuery('')
    setActiveIndex(-1)
    trigger.current?.focus()
  }

  /** Moves the active descendant while retaining editable input focus. */
  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!visible.length) {
        setActiveIndex(-1)
        return
      }
      const next =
        event.key === 'ArrowDown'
          ? Math.min(activeIndex + 1, visible.length - 1)
          : Math.max(activeIndex < 0 ? visible.length - 1 : activeIndex - 1, 0)
      setActiveIndex(next)
    } else if (event.key === 'Tab') {
      setOpen(false)
    } else if (event.key === 'Enter' && visible.length) {
      event.preventDefault()
      void select(visible[Math.min(Math.max(activeIndex, 0), visible.length - 1)]!)
    }
  }

  /** Saves the selection, keeping the popup available when the parent save fails. */
  async function select(cert: Certification) {
    if (disabled || loading || pending) {
      return
    }
    setPending(true)
    try {
      await onSelect(cert)
      close()
    } catch {
      // Keep the picker open so the user can retry after a parent save failure.
    } finally {
      setPending(false)
    }
  }

  const busy = disabled || loading || pending

  return (
    <div className="certification-picker" ref={root}>
      <button
        className="certification-picker-trigger"
        ref={trigger}
        type="button"
        aria-label="Current certification"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        disabled={disabled || loading}
        onClick={() => setOpen((isOpen) => !isOpen)}
      >
        <span className="certification-picker-summary">
          {selected ? (
            <>
              <strong>{selected.platform}</strong> · {selected.name} <span>({selected.code})</span>
            </>
          ) : (
            'Choose a certification'
          )}
        </span>
        <span aria-hidden="true">⌄</span>
      </button>
      {open && (
        <div className="certification-picker-popover">
          <label className="certification-picker-search-label" htmlFor={`${id}-search`}>
            Search certifications
          </label>
          <input
            id={`${id}-search`}
            ref={search}
            className="certification-picker-search"
            type="search"
            role="combobox"
            aria-expanded={open}
            aria-controls={`${id}-list`}
            aria-autocomplete="list"
            aria-activedescendant={
              activeIndex >= 0 && activeIndex < visible.length
                ? `${id}-option-${activeIndex}`
                : undefined
            }
            value={query}
            placeholder="Search name, code, platform…"
            onChange={(event) => {
              setQuery(event.target.value)
              setActiveIndex(-1)
            }}
            onKeyDown={handleSearchKeyDown}
          />
          <div
            className="certification-picker-options"
            id={`${id}-list`}
            role="listbox"
            aria-label="Certifications"
          >
            {visible.map((cert, index) => {
              const previous = visible[index - 1]
              const organizationChanged = previous?.organization !== cert.organization
              const platformChanged = organizationChanged || previous?.platform !== cert.platform
              const levelChanged = platformChanged || previous?.level !== cert.level
              const key = certificationKey(cert)
              return (
                <div className="certification-picker-group" role="presentation" key={key}>
                  {index > 0 && organizationChanged && (
                    <div className="certification-organization-separator" aria-hidden="true" />
                  )}
                  {index > 0 && platformChanged && !organizationChanged && (
                    <div className="certification-platform-separator" aria-hidden="true" />
                  )}
                  {organizationChanged && <h3>{cert.organization}</h3>}
                  {platformChanged && cert.platform !== cert.organization && (
                    <h4>
                      {cert.platform}
                      {cert.platformName && ` (${cert.platformName})`}
                    </h4>
                  )}
                  {levelChanged && cert.level && <h5>{cert.level}</h5>}
                  <button
                    id={`${id}-option-${index}`}
                    className={`certification-picker-option${activeIndex === index ? ' is-active' : ''}`}
                    ref={(element) => {
                      optionRefs.current[index] = element
                    }}
                    type="button"
                    role="option"
                    aria-selected={selected ? certificationKey(selected) === key : false}
                    tabIndex={-1}
                    disabled={busy}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => void select(cert)}
                  >
                    <span>{cert.name}</span>
                    <span className="certification-picker-option-meta">{cert.code}</span>
                  </button>
                </div>
              )
            })}
            {!visible.length && (
              <p className="certification-picker-empty">
                {certifications.length
                  ? 'No certifications match this search.'
                  : 'Import a question bank to add certifications.'}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
