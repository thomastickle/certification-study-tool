import { useCallback, useEffect, useRef, useState } from 'react'
import type { Source } from '../shared/contracts.ts'
import { api } from './api.ts'
import { CertificationPicker } from './CertificationPicker.tsx'
import { certificationKey, certificationsFromSources } from './certifications.ts'
import type { Certification } from './certifications.ts'
import { LibraryPage } from './LibraryPage.tsx'
import { QuizPage } from './QuizPage.tsx'
import { ReportsPage } from './ReportsPage.tsx'
import { HomePage } from './HomePage.tsx'
import { StudyIcon } from './StudyIcon.tsx'
import { WorkspaceSidebar } from './WorkspaceSidebar.tsx'

type Page = 'home' | 'quiz' | 'exam' | 'review' | 'reports' | 'importer'

/** Keep every workspace destination behind the existing practice suspension guard. */
export function App() {
  const [page, setPage] = useState<Page>('home')
  const [practiceMode, setPracticeMode] = useState<'quiz' | 'exam'>('quiz')
  const [practiceSources, setPracticeSources] = useState<Record<string, number[]>>({})
  const [certifications, setCertifications] = useState<Certification[]>([])
  const [selected, setSelected] = useState<Certification | null>(null)
  const [catalogLoading, setCatalogLoading] = useState(true)
  const [catalogError, setCatalogError] = useState('')
  const selectedRef = useRef<Certification | null>(null)
  const [focusPreset, setFocusPreset] = useState(false)
  const destination = page === 'quiz' || page === 'exam' ? 'practice' : page
  const leaveQuiz = useRef<() => Promise<boolean>>(async () => true)

  const navigating = useRef(false)

  /** Refresh after imports without replacing the workspace that is currently in use. */
  const refreshCertifications = useCallback(async () => {
    try {
      const items = certificationsFromSources(await api<Source[]>('/sources'))
      setCertifications(items)
      if (!selectedRef.current) {
        let remembered: string | null = null
        try {
          remembered = localStorage.getItem('study-certification')
        } catch {
          // Storage is optional; the workspace still works for this session.
        }
        const initial =
          items.find((item) => certificationKey(item) === remembered) ?? items[0] ?? null
        selectedRef.current = initial
        setSelected(initial)
      }
      setCatalogError('')
    } catch (reason) {
      setCatalogError(reason instanceof Error ? reason.message : 'Could not load certifications.')
    } finally {
      setCatalogLoading(false)
    }
  }, [])

  useEffect(() => {
    void refreshCertifications()
  }, [refreshCertifications])

  /** Switch only after the current session has safely saved and paused. */
  async function selectCertification(next: Certification) {
    if (navigating.current || (selected && certificationKey(next) === certificationKey(selected))) {
      return
    }
    navigating.current = true
    try {
      if (
        (page === 'quiz' || page === 'exam' || page === 'review') &&
        !(await leaveQuiz.current())
      ) {
        return
      }
      selectedRef.current = next
      setSelected(next)
      try {
        localStorage.setItem('study-certification', certificationKey(next))
      } catch {
        // Selection remains usable when storage is unavailable.
      }
    } finally {
      navigating.current = false
    }
  }

  const scopeKey = selected ? certificationKey(selected) : 'empty'

  /** Serialize page changes while practice work is being suspended. */
  async function navigate(next: Page, presetChange = false) {
    if (navigating.current || next === page) {
      return
    }
    navigating.current = true
    try {
      if (
        (page === 'quiz' || page === 'exam' || page === 'review') &&
        next !== page &&
        !(await leaveQuiz.current())
      ) {
        return
      }
      if (next === 'quiz' || next === 'exam') setPracticeMode(next)
      setFocusPreset(presetChange)
      setPage(next)
    } finally {
      navigating.current = false
    }
  }

  return (
    <div className="app-shell">
      <header className="workspace-header">
        <button
          className="brand-button"
          onClick={() => {
            void navigate('home')
          }}
        >
          <StudyIcon name="cloud" />
          <span>
            Certification <span className="brand-secondary">Study Tool</span>
          </span>
        </button>
        <CertificationPicker
          certifications={certifications}
          selected={selected}
          loading={catalogLoading}
          onSelect={selectCertification}
        />
        <span className="local-badge">
          <span aria-hidden="true" />
          Local workspace
        </span>
      </header>
      <WorkspaceSidebar
        destination={destination}
        onNavigate={(next) => {
          void navigate(next === 'practice' ? practiceMode : next)
        }}
      />
      <div className="workspace-content">
        {catalogError && (
          <div className="message error" role="alert">
            {catalogError}{' '}
            <button onClick={() => void refreshCertifications()}>Retry certifications</button>
          </div>
        )}
        {page === 'home' && (
          <HomePage
            onNavigate={(next) => {
              void navigate(next === 'practice' ? practiceMode : next)
            }}
          />
        )}
        {(page === 'quiz' || page === 'exam' || page === 'review') && selected && (
          <QuizPage
            key={`${scopeKey}-${page}`}
            certification={selected}
            mode={page}
            initialSourceIds={practiceSources[scopeKey]}
            onSourceIdsChange={(sourceIds) => {
              setPracticeSources((current) => ({ ...current, [scopeKey]: sourceIds }))
            }}
            focusPreset={focusPreset}
            onPresetChange={
              page === 'review'
                ? undefined
                : (mode) => {
                    void navigate(mode, true)
                  }
            }
            onRegisterLeave={(fn) => {
              leaveQuiz.current = fn
            }}
          />
        )}
        {page === 'reports' && selected && <ReportsPage key={scopeKey} certification={selected} />}
        {!selected && page !== 'home' && page !== 'importer' && (
          <main>
            <h1>
              {catalogLoading ? 'Loading certifications…' : 'Import a question bank to get started'}
            </h1>
            {!catalogLoading && (
              <button onClick={() => void navigate('importer')}>Open library</button>
            )}
          </main>
        )}
        {page === 'importer' && <LibraryPage onLibraryChange={refreshCertifications} />}
      </div>
    </div>
  )
}
