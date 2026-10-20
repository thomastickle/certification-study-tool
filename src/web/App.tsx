import { useRef, useState } from 'react'
import { LibraryPage } from './LibraryPage.tsx'
import { QuizPage } from './QuizPage.tsx'
import { ReportsPage } from './ReportsPage.tsx'

type Page = 'home' | 'quiz' | 'exam' | 'review' | 'reports' | 'importer'

type Destination = 'practice' | 'review' | 'reports' | 'importer'

const links: { id: Destination; label: string }[] = [
  { id: 'practice', label: 'Practice' },
  { id: 'review', label: 'Due Review' },
  { id: 'reports', label: 'Reports' },
  { id: 'importer', label: 'Importer' },
]

const descriptions: Record<Destination, string> = {
  practice: 'Choose a short quiz or a full-length exam, then review your answers.',
  review: 'Review due retention checks without quiz or exam domain quotas.',
  reports: 'Explore your progress, domain strengths, and every attempt.',
  importer: 'Manage your question library and sources.',
}

export function App() {
  const [page, setPage] = useState<Page>('home')
  const [practiceMode, setPracticeMode] = useState<'quiz' | 'exam'>('quiz')
  const [practiceSourceIds, setPracticeSourceIds] = useState<number[]>()
  const [focusPreset, setFocusPreset] = useState(false)
  const leaveQuiz = useRef<() => Promise<boolean>>(async () => true)
  const destination = page === 'quiz' || page === 'exam' ? 'practice' : page

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
      <header className="masthead">
        <button
          className="brand brand-button"
          onClick={() => {
            void navigate('home')
          }}
        >
          <span className="brand-mark" aria-hidden="true">
            S
          </span>
          <span>Certification Study Tool</span>
        </button>
        <nav className="app-nav" aria-label="Main navigation">
          {links.map((link) => (
            <button
              key={link.id}
              className={destination === link.id ? 'active' : ''}
              aria-current={destination === link.id ? 'page' : undefined}
              onClick={() => {
                void navigate(link.id === 'practice' ? practiceMode : link.id)
              }}
            >
              {link.label}
            </button>
          ))}
        </nav>
        <span className="local-badge">
          <span aria-hidden="true" /> Local workspace
        </span>
      </header>
      {page === 'home' && (
        <main>
          <div className="page-heading">
            <div>
              <p className="eyebrow">YOUR STUDY WORKSPACE</p>
              <h1>Build knowledge, one question at a time.</h1>
              <p className="intro">Choose where you want to begin.</p>
            </div>
          </div>
          <section className="home-cards" aria-label="Study tools">
            {links.map((link) => (
              <button
                key={link.id}
                className="home-card"
                onClick={() => {
                  void navigate(link.id === 'practice' ? practiceMode : link.id)
                }}
              >
                <span className="eyebrow">STUDY WORKSPACE</span>
                <strong>{link.label}</strong>
                <span>{descriptions[link.id]}</span>
                <span className="home-card-action">Open →</span>
              </button>
            ))}
          </section>
        </main>
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
  )
}
