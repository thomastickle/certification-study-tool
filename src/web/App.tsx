import { useRef, useState } from 'react'
import { LibraryPage } from './LibraryPage.tsx'
import { QuizPage } from './QuizPage.tsx'
import { ReportsPage } from './ReportsPage.tsx'
import { HomePage } from './HomePage.tsx'

type Page = 'home' | 'quiz' | 'exam' | 'review' | 'reports' | 'importer'

const links: { id: Page; label: string }[] = [
  { id: 'home', label: 'Home' },
  { id: 'quiz', label: 'Quiz' },
  { id: 'exam', label: 'Exam' },
  { id: 'review', label: 'Due Review' },
  { id: 'reports', label: 'Reports' },
  { id: 'importer', label: 'Importer' },
]

/** Keep practice navigation serialized so a session is safely suspended before leaving. */
export function App() {
  const [page, setPage] = useState<Page>('home')
  const leaveQuiz = useRef<() => Promise<boolean>>(async () => true)

  const navigating = useRef(false)

  /** Serialize page changes while practice work is being suspended. */
  async function navigate(next: Page) {
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
      setPage(next)
    } finally {
      navigating.current = false
    }
  }

  return (
    <div className="app-shell">
      <header className="masthead">
        <button
          className="brand brand-button"
          onClick={() => {
            void navigate('home')
          }}
        >
          <span className="brand-mark" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          <span>Certification Study Tool</span>
        </button>
        <nav className="app-nav" aria-label="Main navigation">
          {links.map((link) => (
            <button
              key={link.id}
              className={page === link.id ? 'active' : ''}
              aria-current={page === link.id ? 'page' : undefined}
              onClick={() => {
                void navigate(link.id)
              }}
            >
              {link.label}
            </button>
          ))}
        </nav>
      </header>
      <div className="workspace-context">
        <div className="certification-context" role="group" aria-label="Practice certification">
          <span className="context-label">Practice certification</span>
          <strong>AWS Cloud Practitioner</strong>
          <span className="exam-code">CLF-C02</span>
        </div>
        <span className="local-badge">
          <span aria-hidden="true" /> Local workspace
        </span>
      </div>
      {page === 'home' && (
        <HomePage
          onNavigate={(next) => {
            void navigate(next)
          }}
        />
      )}
      {(page === 'quiz' || page === 'exam' || page === 'review') && (
        <QuizPage
          key={page}
          mode={page}
          onRegisterLeave={(fn) => {
            leaveQuiz.current = fn
          }}
        />
      )}
      {page === 'reports' && <ReportsPage />}
      {page === 'importer' && <LibraryPage />}
    </div>
  )
}
