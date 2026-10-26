import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { SessionUser } from '../../shared/auth-contracts.ts'
import type { LibraryItemId, Source } from '../../shared/contracts.ts'
import { useWorkspaceApi } from '../shared/lib/workspace-api.ts'
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

type WorkspaceTransition =
  | { kind: 'page'; next: Page; presetChange: boolean }
  | {
      kind: 'certification'
      next: Certification
      studyPage?: 'quiz' | 'exam' | 'review'
      sourceIds?: LibraryItemId[]
    }
  | { kind: 'logout'; form: HTMLFormElement }

/** Keep every workspace destination behind the existing practice suspension guard. */
export function App({ account }: { account: SessionUser }) {
  const workspace = useWorkspaceApi()
  const { api } = workspace
  const appearance = useAppearance()
  const [page, setPage] = useState<Page>('home')
  const [practiceVisit, setPracticeVisit] = useState(0)
  const [practiceMode, setPracticeMode] = useState<'quiz' | 'exam'>('quiz')
  const [practiceSources, setPracticeSources] = useState<Record<string, LibraryItemId[]>>({})
  const [certifications, setCertifications] = useState<Certification[]>([])
  const [selected, setSelected] = useState<Certification | null>(null)
  const [catalogLoading, setCatalogLoading] = useState(true)
  const [catalogError, setCatalogError] = useState('')
  const [transitionError, setTransitionError] = useState('')
  const selectedRef = useRef<Certification | null>(null)
  const [focusPreset, setFocusPreset] = useState(false)
  const destination = page === 'quiz' || page === 'exam' ? 'practice' : page
  const leaveQuiz = useRef<() => Promise<boolean>>(async () => true)

  const navigating = useRef(false)

  /** Refresh after imports without replacing the workspace that is currently in use. */
  const refreshCertifications = useCallback(async () => {
    try {
      const sources = await api<Source[]>('/sources')
      const items = certificationsFromSources(sources)
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
  }, [account.id, api])

  useEffect(() => {
    void refreshCertifications()
  }, [refreshCertifications])

  /** Pause saved work for the previous certification before committing a new selection. */
  async function applyCertificationSelection(
    transition: Extract<WorkspaceTransition, { kind: 'certification' }>,
  ) {
    const { next, studyPage, sourceIds } = transition
    const switching = !selected || certificationKey(next) !== certificationKey(selected)
    if (selected && switching) {
      await pauseCertificationAttempts(selected, workspace)
    }
    if (!workspace.isActive()) {
      return
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
  }

  /** Commit page state only after the shared practice-exit coordinator permits the transition. */
  function applyPageChange(next: Page, presetChange: boolean) {
    if (next === 'quiz' || next === 'exam') {
      setPracticeMode(next)
    }
    setFocusPreset(presetChange)
    if (next === page) {
      setPracticeVisit((visit) => visit + 1)
    }
    setPage(next)
  }

  /** Serialize exits, retain failed work with feedback, and ignore obsolete workspace continuations. */
  async function transitionWorkspace(transition: WorkspaceTransition) {
    const inPractice = page === 'quiz' || page === 'exam' || page === 'review'
    if (navigating.current) {
      return
    }
    if (transition.kind === 'page' && transition.next === page && !inPractice) {
      return
    }
    if (transition.kind === 'certification') {
      const sameSelection =
        selected && certificationKey(transition.next) === certificationKey(selected)
      if (sameSelection && !transition.studyPage) {
        return
      }
    }
    navigating.current = true
    setTransitionError('')
    try {
      if (inPractice) {
        const canLeave = await leaveQuiz.current()
        if (!canLeave) {
          return
        }
      }
      if (!workspace.isActive()) {
        return
      }
      switch (transition.kind) {
        case 'certification':
          await applyCertificationSelection(transition)
          break
        case 'page':
          applyPageChange(transition.next, transition.presetChange)
          break
        case 'logout':
          transition.form.submit()
          break
      }
    } catch (reason) {
      if (!workspace.isActive()) {
        return
      }
      const message =
        reason instanceof Error ? reason.message : 'Could not save and pause the current attempt.'
      let recovery = 'Your page has not changed. Retry navigation to pause saved work safely.'
      if (transition.kind === 'certification') {
        recovery =
          'Your certification has not changed. Retry the selection to pause saved work safely.'
      } else if (transition.kind === 'logout') {
        recovery = 'You are still signed in. Retry Sign out to pause saved work safely.'
      }
      setTransitionError(`${message} ${recovery}`)
    } finally {
      navigating.current = false
    }
  }

  /** Adapt picker and Home selections to the explicit certification transition. */
  function selectCertification(
    next: Certification,
    studyPage?: 'quiz' | 'exam' | 'review',
    sourceIds?: LibraryItemId[],
  ) {
    return transitionWorkspace({ kind: 'certification', next, studyPage, sourceIds })
  }

  /** Open a Home action in its named certification using the same safe switch as the picker. */
  function studyTrack(track: CertificationProgress, mode: 'practice' | 'review') {
    const target = certifications.find(
      (certification) => certificationKey(certification) === certificationKey(track),
    )
    if (!target) {
      setTransitionError(
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

  /** Adapt sidebar and preset changes to the same practice-exit transition. */
  function navigate(next: Page, presetChange = false) {
    return transitionWorkspace({ kind: 'page', next, presetChange })
  }

  /** Preserve native form submission after the shared save/pause guard has completed. */
  function signOut(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    return transitionWorkspace({ kind: 'logout', form: event.currentTarget })
  }

  return (
    <div className="app-shell" data-study-account={account.id} data-study-role={account.role}>
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
        {transitionError && (
          <div className="message error" role="alert">
            {transitionError}
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
        {page === 'importer' && (
          <LibraryPage
            canManage={account.role === 'admin'}
            onLibraryChange={refreshCertifications}
          />
        )}
      </div>
    </div>
  )
}
