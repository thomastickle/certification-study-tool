import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent, PointerEvent } from 'react'
import { StudyIcon } from './StudyIcon.tsx'

export type Destination = 'home' | 'practice' | 'review' | 'reports' | 'importer'

type Props = { destination: Destination; onNavigate: (destination: Destination) => void }

type Layout = { collapsed: boolean; width?: number }

type Drag = { pointerId: number; x: number; width: number; layout: Layout }

const links: { id: Destination; label: string }[] = [
  { id: 'home', label: 'Home' },
  { id: 'practice', label: 'Practice' },
  { id: 'review', label: 'Due Review' },
  { id: 'importer', label: 'Importer' },
  { id: 'reports', label: 'Reports' },
]

/** Invalid or unavailable preferences should leave navigation usable. */
function readLayout(): Layout {
  try {
    const width = Number(localStorage.getItem('study-sidebar-width'))
    return {
      collapsed: localStorage.getItem('study-sidebar-collapsed') === 'true',
      width: Number.isFinite(width) && width >= 180 && width <= 320 ? width : undefined,
    }
  } catch {
    return { collapsed: false }
  }
}

/** Keep the visual preference optional when browser storage is blocked. */
function saveLayout(layout: Layout) {
  try {
    localStorage.setItem('study-sidebar-collapsed', String(layout.collapsed))
    if (layout.width !== undefined)
      localStorage.setItem('study-sidebar-width', String(layout.width))
  } catch {
    // Resizing still works for this session.
  }
}

/** Resize only the navigation column, keeping the active study page mounted. */
export function WorkspaceSidebar({ destination, onNavigate }: Props) {
  const [layout, setLayout] = useState(readLayout)
  const [actualWidth, setActualWidth] = useState(220)
  const region = useRef<HTMLDivElement>(null)
  const drag = useRef<Drag | null>(null)
  const current = useRef(layout)
  current.current = layout
  const width = layout.collapsed ? 72 : layout.width

  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setActualWidth(Math.round(entry.borderBoxSize[0]!.inlineSize))
    })
    observer.observe(region.current!)
    return () => observer.disconnect()
  }, [])

  /** Remember explicit button and keyboard changes immediately. */
  function apply(next: Layout) {
    current.current = next
    setLayout(next)
    saveLayout(next)
  }

  /** Restore the previous expanded width when opening the icon rail. */
  function toggle() {
    apply({ ...layout, collapsed: !layout.collapsed })
  }

  /** Snap a narrow drag to the icon rail and bound the expanded column. */
  function resized(value: number, previous: Layout): Layout {
    if (value < 140) return { ...previous, collapsed: true }
    return { collapsed: false, width: Math.max(180, Math.min(320, Math.round(value))) }
  }

  /** Capture the pointer so dragging continues beyond the narrow edge. */
  function startDrag(event: PointerEvent<HTMLDivElement>) {
    if (!event.isPrimary || event.button !== 0 || drag.current) return
    event.preventDefault()
    event.currentTarget.focus()
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      width: region.current!.getBoundingClientRect().width,
      layout,
    }
  }

  /** Measure movement from the original edge, including after collapsing mid-drag. */
  function moveDrag(event: PointerEvent<HTMLDivElement>) {
    const start = drag.current
    if (!start || start.pointerId !== event.pointerId) return
    const next = resized(start.width + event.clientX - start.x, start.layout)
    current.current = next
    setLayout(next)
  }

  /** Save a completed drag; cancellation restores the pre-drag layout. */
  function finishDrag(event: PointerEvent<HTMLDivElement>) {
    const start = drag.current
    if (!start || start.pointerId !== event.pointerId) return
    drag.current = null
    apply(event.type === 'pointercancel' ? start.layout : current.current)
  }

  /** Expose the same size and collapse operations without requiring a pointer. */
  function resizeWithKeyboard(event: KeyboardEvent<HTMLDivElement>) {
    const actual = region.current!.getBoundingClientRect().width
    const step = event.shiftKey ? 10 : 1
    let next: Layout
    switch (event.key) {
      case 'ArrowLeft':
        next = actual <= 180 ? { ...layout, collapsed: true } : resized(actual - step, layout)
        break
      case 'ArrowRight':
        next = resized(actual + (layout.collapsed ? 108 : step), layout)
        break
      case 'Home':
        next = { ...layout, collapsed: true }
        break
      case 'End':
        next = { collapsed: false, width: 320 }
        break
      case 'Enter':
        next = { ...layout, collapsed: !layout.collapsed }
        break
      default:
        return
    }
    event.preventDefault()
    apply(next)
  }

  return (
    <div
      ref={region}
      className={`sidebar-region${layout.collapsed ? ' sidebar-collapsed' : ''}`}
      style={{ '--sidebar-width': width === undefined ? undefined : `${width}px` } as CSSProperties}
    >
      <aside className="workspace-sidebar" id="workspace-navigation">
        <nav id="main-navigation" className="app-nav" aria-label="Main navigation">
          {links.map((link) => (
            <button
              key={link.id}
              className={destination === link.id ? 'active' : ''}
              aria-current={destination === link.id ? 'page' : undefined}
              aria-label={link.label}
              title={layout.collapsed ? link.label : undefined}
              onClick={() => onNavigate(link.id)}
            >
              <StudyIcon name={link.id} />
              <span>{link.label}</span>
            </button>
          ))}
        </nav>
        <p className="sidebar-note">
          Your library and progress
          <br />
          stay on this device.
        </p>
      </aside>
      <div className="sidebar-edge">
        <div
          className="sidebar-resize"
          role="separator"
          tabIndex={0}
          aria-label="Resize navigation"
          aria-orientation="vertical"
          aria-controls="workspace-navigation"
          aria-valuemin={72}
          aria-valuemax={320}
          aria-valuenow={width ?? actualWidth}
          title="Drag to resize navigation"
          onPointerDown={startDrag}
          onPointerMove={moveDrag}
          onPointerUp={finishDrag}
          onPointerCancel={finishDrag}
          onLostPointerCapture={finishDrag}
          onKeyDown={resizeWithKeyboard}
        />
        <button
          className="sidebar-toggle"
          aria-label={layout.collapsed ? 'Expand navigation' : 'Collapse navigation'}
          title={layout.collapsed ? 'Expand navigation' : 'Collapse navigation'}
          aria-expanded={!layout.collapsed}
          aria-controls="main-navigation"
          onClick={toggle}
        >
          <StudyIcon name="chevron" />
        </button>
      </div>
    </div>
  )
}
