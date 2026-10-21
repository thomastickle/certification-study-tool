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

type CertificationGroup = { organization: string; platform: string; certifications: Certification[] }

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

  const filtered = useMemo(() => filterCertifications(certifications, query), [certifications, query])
  const groups = useMemo(() => {
    const grouped = new Map<string, CertificationGroup>()
    for (const cert of filtered) {
      const key = JSON.stringify([cert.organization, cert.platform])
      const group = grouped.get(key) ?? {
        organization: cert.organization,
        platform: cert.platform,
        certifications: [],
      }
      group.certifications.push(cert)
      grouped.set(key, group)
    }
    return [...grouped.values()]
  }, [filtered])

  useEffect(() => {
    if (open) search.current?.focus()
  }, [open])

  useEffect(() => {
    if (activeIndex >= 0) optionRefs.current[activeIndex]?.focus()
  }, [activeIndex])

  useEffect(() => {
    if (!open) return
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false)
    }
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

  function close() {
    setOpen(false)
    setQuery('')
    setActiveIndex(-1)
    trigger.current?.focus()
  }

  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const next = event.key === 'ArrowDown'
        ? Math.min(activeIndex + 1, filtered.length - 1)
        : Math.max(activeIndex < 0 ? filtered.length - 1 : activeIndex - 1, 0)
      setActiveIndex(next)
    } else if (event.key === 'Enter' && filtered.length) {
      event.preventDefault()
      void select(filtered[Math.max(activeIndex, 0)]!)
    }
  }

  function handleOptionKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    if (event.key === 'ArrowUp' && index === 0) {
      setActiveIndex(-1)
      search.current?.focus()
      return
    }
    setActiveIndex(event.key === 'ArrowDown'
      ? Math.min(index + 1, filtered.length - 1)
      : Math.max(index - 1, 0))
  }

  async function select(cert: Certification) {
    if (disabled || loading || pending) return
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

  let optionIndex = 0
  const busy = disabled || loading || pending

  return (
    <div className="certification-picker" ref={root}>
      <button
        className="certification-picker-trigger"
        ref={trigger}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        disabled={disabled || loading}
        onClick={() => setOpen((isOpen) => !isOpen)}
      >
        <span className="certification-picker-summary">
          {selected ? <><strong>{selected.provider}</strong> · {selected.name} <span>({selected.code})</span></> : 'Choose a certification'}
        </span>
        <span aria-hidden="true">⌄</span>
      </button>
      {open && (
        <div className="certification-picker-popover" id={`${id}-list`}>
          <label className="certification-picker-search-label" htmlFor={`${id}-search`}>Search certifications</label>
          <input
            id={`${id}-search`}
            ref={search}
            className="certification-picker-search"
            type="search"
            value={query}
            placeholder="Search name, code, platform…"
            onChange={(event) => {
              setQuery(event.target.value)
              setActiveIndex(-1)
            }}
            onKeyDown={handleSearchKeyDown}
          />
          <div className="certification-picker-options" role="listbox" aria-label="Certifications">
            {groups.map((group) => (
              <section className="certification-picker-group" key={`${group.organization}/${group.platform}`}>
                <h3>{group.organization}{group.platform !== group.organization && <> <span>·</span> {group.platform}</>}</h3>
                {group.certifications.map((cert) => {
                  const index = optionIndex++
                  const key = certificationKey(cert)
                  return (
                    <button
                      className="certification-picker-option"
                      key={key}
                      ref={(element) => { optionRefs.current[index] = element }}
                      type="button"
                      role="option"
                      aria-selected={selected ? certificationKey(selected) === key : false}
                      tabIndex={-1}
                      disabled={busy}
                      onKeyDown={(event) => handleOptionKeyDown(event, index)}
                      onClick={() => void select(cert)}
                    >
                      <span>{cert.name}</span>
                      <span className="certification-picker-option-meta">{cert.code}{cert.level ? ` · ${cert.level}` : ''}</span>
                    </button>
                  )
                })}
              </section>
            ))}
            {!filtered.length && <p className="certification-picker-empty">No certifications match this search.</p>}
          </div>
        </div>
      )}
    </div>
  )
}
