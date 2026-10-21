import { useRef, useState } from 'react'
import { LibraryPage } from './LibraryPage.tsx'
import { QuizPage } from './QuizPage.tsx'
import { ReportsPage } from './ReportsPage.tsx'
import { HomePage } from './HomePage.tsx'
import { CertificationsPage } from './CertificationsPage.tsx'
import { StudyIcon } from './StudyIcon.tsx'
import { WorkspaceSidebar } from './WorkspaceSidebar.tsx'

type Page = 'home' | 'quiz' | 'exam' | 'review' | 'reports' | 'importer' | 'certifications'

/** Keep every workspace destination behind the existing practice suspension guard. */
export function App() {
  const [page, setPage] = useState<Page>('home')
  const [practiceMode, setPracticeMode] = useState<'quiz' | 'exam'>('quiz')
  const [practiceSourceIds, setPracticeSourceIds] = useState<number[]>()
  const [focusPreset, setFocusPreset] = useState(false)
  const destination = page === 'quiz' || page === 'exam' ? 'practice' : page
  const leaveQuiz = useRef<() => Promise<boolean>>(async () => true)

  const navigating = useRef(false)

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
        {page === 'home' || page === 'certifications' ? (
          <div className="certification-label" role="group" aria-label="All certifications">
            <strong>All certifications</strong>
          </div>
        ) : (
          <div className="certification-label" role="group" aria-label="Current certification">
            <span className="certification-provider">AWS</span>
            <strong>Cloud Practitioner</strong>
            <span className="certification-code">CLF-C02</span>
          </div>
        )}
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
        {page === 'home' && (
          <HomePage
            onNavigate={(next) => {
              void navigate(next === 'practice' ? practiceMode : next)
            }}
            onPractice={(sourceIds) => {
              setPracticeSourceIds(sourceIds)
              void navigate(practiceMode)
            }}
          />
        )}
        {(page === 'quiz' || page === 'exam' || page === 'review') && (
          <QuizPage
            key={page}
            mode={page}
            initialSourceIds={page === 'review' ? undefined : practiceSourceIds}
            onSourceIdsChange={page === 'review' ? undefined : setPracticeSourceIds}
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
        {page === 'reports' && <ReportsPage />}
        {page === 'importer' && <LibraryPage />}
        {page === 'certifications' && <CertificationsPage />}
      </div>
    </div>
  )
}
