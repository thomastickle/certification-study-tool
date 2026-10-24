import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { SessionUser } from '../../shared/auth-contracts.ts'
import type { Source } from '../../shared/contracts.ts'
import { api } from '../shared/lib/api.ts'
import { CertificationPicker } from '../features/certifications/CertificationPicker.tsx'
import {
  certificationKey,
  certificationsFromSources,
} from '../features/certifications/certifications.ts'
import type { Certification } from '../features/certifications/certifications.ts'
import { LibraryPage } from '../features/library/LibraryPage.tsx'
import { QuizPage } from '../features/practice/QuizPage.tsx'
import { ReportsPage } from '../features/reports/ReportsPage.tsx'
import { HomePage } from '../features/home/HomePage.tsx'
import { CertificationsPage } from '../features/certifications/CertificationsPage.tsx'
import { StudyIcon } from '../shared/ui/StudyIcon.tsx'
import { SettingsPage } from '../features/settings/SettingsPage.tsx'
import { useAppearance } from './use-appearance.ts'
import { WorkspaceSidebar } from './WorkspaceSidebar.tsx'
import { pauseCertificationAttempts } from './workspace-session.ts'
import type { CertificationProgress } from '../../shared/home-contracts.ts'

type Page =
  'home' | 'quiz' | 'exam' | 'review' | 'reports' | 'importer' | 'certifications' | 'settings'

/** Keep every workspace destination behind the existing practice suspension guard. */
export function App({ account }: { account: SessionUser }) {
  const appearance = useAppearance()
  const [page, setPage] = useState<Page>('home')
  const [practiceVisit, setPracticeVisit] = useState(0)
  const [practiceMode, setPracticeMode] = useState<'quiz' | 'exam'>('quiz')
  const [practiceSources, setPracticeSources] = useState<Record<string, number[]>>({})
  const [certifications, setCertifications] = useState<Certification[]>([])
  const [selected, setSelected] = useState<Certification | null>(null)
  const [catalogLoading, setCatalogLoading] = useState(true)
  const [catalogError, setCatalogError] = useState('')
  const [selectionError, setSelectionError] = useState('')
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
          remembered = localStorage.getItem(`study-certification:${account.id}`)
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
  }, [account.id])

  useEffect(() => {
    void refreshCertifications()
  }, [refreshCertifications])

  /** Switch only after the current session has safely saved and paused. */
  async function selectCertification(
    next: Certification,
    studyPage?: 'quiz' | 'exam' | 'review',
    sourceIds?: number[],
  ) {
    if (navigating.current) {
      return
    }
    const switching = !selected || certificationKey(next) !== certificationKey(selected)
    if (!switching && !studyPage) {
      return
    }
    navigating.current = true
    setSelectionError('')
    try {
      if (
        (page === 'quiz' || page === 'exam' || page === 'review') &&
        !(await leaveQuiz.current())
      ) {
        return
      }
      if (selected && switching) {
        await pauseCertificationAttempts(selected)
      }
      selectedRef.current = next
      setSelected(next)
      try {
        localStorage.setItem(`study-certification:${account.id}`, certificationKey(next))
      } catch {
        // Selection remains usable when storage is unavailable.
      }
      if (studyPage) {
        if (sourceIds) {
          setPracticeSources((current) => ({ ...current, [certificationKey(next)]: sourceIds }))
        }
        if (studyPage === 'quiz' || studyPage === 'exam') {
          setPracticeMode(studyPage)
        }
        setFocusPreset(false)
        setPage(studyPage)
      }
    } catch (reason) {
      const message =
        reason instanceof Error ? reason.message : 'Could not suspend the previous attempt.'
      setSelectionError(
        `${message} Your certification has not changed. Retry the selection to pause saved work safely.`,
      )
    } finally {
      navigating.current = false
    }
  }

  /** Open a Home action in its named certification using the same safe switch as the picker. */
  function studyTrack(track: CertificationProgress, mode: 'practice' | 'review') {
    const target = certifications.find(
      (certification) => certificationKey(certification) === certificationKey(track),
    )
    if (!target) {
      setSelectionError(
        'Import eligible question banks for this certification before starting practice or review.',
      )
      return
    }
    void selectCertification(
      target,
      mode === 'practice' ? practiceMode : 'review',
      mode === 'practice' ? track.sourceIds : undefined,
    )
  }

  const scopeKey = selected ? certificationKey(selected) : 'empty'

  /** Serialize page changes while practice work is being suspended. */
  async function navigate(next: Page, presetChange = false) {
    const inPractice = page === 'quiz' || page === 'exam' || page === 'review'
    if (navigating.current || (next === page && !inPractice)) {
      return
    }
    navigating.current = true
    try {
      if (inPractice && !(await leaveQuiz.current())) {
        return
      }
      if (next === 'quiz' || next === 'exam') setPracticeMode(next)
      setFocusPreset(presetChange)
      if (next === page) {
        setPracticeVisit((visit) => visit + 1)
      }
      setPage(next)
    } finally {
      navigating.current = false
    }
  }

  /** Save and pause practice before the browser leaves to end the sign-in session. */
  async function signOut(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (navigating.current) return
    const form = event.currentTarget
    navigating.current = true
    try {
      const inPractice = page === 'quiz' || page === 'exam' || page === 'review'
      if (inPractice && !(await leaveQuiz.current())) return
      form.submit()
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
        <form
          className="workspace-account"
          action="/auth/logout"
          method="post"
          onSubmit={(event) => {
            void signOut(event)
          }}
        >
          <span title={account.name}>{account.name}</span>
          <button type="submit">Sign out</button>
        </form>
      </header>
      <WorkspaceSidebar
        destination={destination}
        onNavigate={(next) => {
          void navigate(next === 'practice' ? practiceMode : next)
        }}
      />
      <div className="workspace-content">
        {selectionError && (
          <div className="message error" role="alert">
            {selectionError}
          </div>
        )}
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
            onPractice={(track) => studyTrack(track, 'practice')}
            onReview={(track) => studyTrack(track, 'review')}
          />
        )}
        {(page === 'quiz' || page === 'exam' || page === 'review') && selected && (
          <QuizPage
            key={`${scopeKey}-${page}-${practiceVisit}`}
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
        {page === 'settings' && <SettingsPage appearance={appearance} />}
        {page === 'certifications' && <CertificationsPage />}
        {page === 'reports' && selected && <ReportsPage key={scopeKey} certification={selected} />}
        {!selected &&
          page !== 'home' &&
          page !== 'importer' &&
          page !== 'certifications' &&
          page !== 'settings' && (
            <main>
              <h1>
                {catalogLoading
                  ? 'Loading certifications…'
                  : 'Import a question bank to get started'}
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
