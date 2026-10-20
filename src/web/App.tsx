import { useRef, useState } from 'react'
import { LibraryPage } from './LibraryPage.tsx'
import { QuizPage } from './QuizPage.tsx'
import { ReportsPage } from './ReportsPage.tsx'
import { HomePage } from './HomePage.tsx'
import { StudyIcon } from './StudyIcon.tsx'

type Page = 'home' | 'quiz' | 'exam' | 'review' | 'reports' | 'importer'

type Destination = 'home' | 'practice' | 'review' | 'reports' | 'importer'

const links: { id: Destination; label: string }[] = [
  { id: 'home', label: 'Home' },
  { id: 'practice', label: 'Practice' },
  { id: 'review', label: 'Due Review' },
  { id: 'importer', label: 'Importer' },
  { id: 'reports', label: 'Reports' },
]

/** A blocked browser preference store should not prevent the workspace from opening. */
function readSidebarCollapsed() {
  try {
    return localStorage.getItem('study-sidebar-collapsed') === 'true'
  } catch {
    return false
  }
}

/** Keep every workspace destination behind the existing practice suspension guard. */
export function App() {
  const [page, setPage] = useState<Page>('home')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(readSidebarCollapsed)
  const [practiceMode, setPracticeMode] = useState<'quiz' | 'exam'>('quiz')
  const [practiceSourceIds, setPracticeSourceIds] = useState<number[]>()
  const [focusPreset, setFocusPreset] = useState(false)
  const destination = page === 'quiz' || page === 'exam' ? 'practice' : page
  const leaveQuiz = useRef<() => Promise<boolean>>(async () => true)

  const navigating = useRef(false)

  /** Remember the visual preference without making browser storage a requirement. */
  function toggleSidebar() {
    const next = !sidebarCollapsed
    setSidebarCollapsed(next)
    try {
      localStorage.setItem('study-sidebar-collapsed', String(next))
    } catch {
      // The current session still works when preferences cannot be persisted.
    }
  }

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
    <div className={`app-shell${sidebarCollapsed ? ' sidebar-collapsed' : ''}`}>
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
        <div className="certification-label" role="group" aria-label="Current certification">
          <span className="certification-provider">AWS</span>
          <strong>Cloud Practitioner</strong>
          <span className="certification-code">CLF-C02</span>
        </div>
        <span className="local-badge">
          <span aria-hidden="true" />
          Local workspace
        </span>
      </header>
      <aside className="workspace-sidebar">
        <button
          className="sidebar-toggle"
          aria-label={sidebarCollapsed ? 'Expand navigation' : 'Collapse navigation'}
          title={sidebarCollapsed ? 'Expand navigation' : 'Collapse navigation'}
          aria-expanded={!sidebarCollapsed}
          aria-controls="main-navigation"
          onClick={toggleSidebar}
        >
          <StudyIcon name="sidebar" />
          <span>Collapse</span>
        </button>
        <nav id="main-navigation" className="app-nav" aria-label="Main navigation">
          {links.map((link) => (
            <button
              key={link.id}
              className={destination === link.id ? 'active' : ''}
              aria-current={destination === link.id ? 'page' : undefined}
              aria-label={link.label}
              title={sidebarCollapsed ? link.label : undefined}
              onClick={() => {
                void navigate(link.id === 'practice' ? practiceMode : link.id)
              }}
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
      <div className="workspace-content">
        {page === 'home' && (
          <HomePage
            onNavigate={(next) => {
              void navigate(next === 'practice' ? practiceMode : next)
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
      </div>
    </div>
  )
}
