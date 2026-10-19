import { useRef, useState } from 'react'
import { LibraryPage } from './LibraryPage.tsx'
import { QuizPage } from './QuizPage.tsx'
import { ReportsPage } from './ReportsPage.tsx'

type Page = 'home' | 'quiz' | 'exam' | 'reports' | 'importer'

const links: { id: Page; label: string }[] = [
  { id: 'quiz', label: 'Quiz' },
  { id: 'exam', label: 'Exam' },
  { id: 'reports', label: 'Reports' },
  { id: 'importer', label: 'Importer' },
]

const descriptions: Partial<Record<Page, string>> = {
  quiz: 'Start a timed quiz and review your answers.',
  exam: 'Exam tools are coming soon.',
  reports: 'Explore your progress, domain strengths, and every attempt.',
  importer: 'Manage your question library and sources.',
}

export function App() {
  const [page, setPage] = useState<Page>('home')
  const leaveQuiz = useRef<() => Promise<boolean>>(async () => true)

  async function navigate(next: Page) {
    if (page === 'quiz' && next !== 'quiz' && !(await leaveQuiz.current())) return
    setPage(next)
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
          <span>Study Library</span>
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
                  void navigate(link.id)
                }}
              >
                <span className="eyebrow">STUDY WORKSPACE</span>
                <strong>{link.label}</strong>
                <span>{descriptions[link.id]}</span>
                <span className="home-card-action">
                  {link.id === 'exam' ? 'Coming soon' : 'Open →'}
                </span>
              </button>
            ))}
          </section>
        </main>
      )}
      {page === 'quiz' && (
        <QuizPage
          onRegisterLeave={(fn) => {
            leaveQuiz.current = fn
          }}
        />
      )}
      {page === 'reports' && <ReportsPage />}
      {page === 'exam' && (
        <main>
          <div className="page-heading">
            <div>
              <p className="eyebrow">STUDY WORKSPACE</p>
              <h1>Exam</h1>
              <p className="intro">This section is coming soon.</p>
            </div>
            <button
              onClick={() => {
                void navigate('home')
              }}
            >
              Back to workspace
            </button>
          </div>
          <section className="placeholder-panel">
            <h2>Exam mode is not available yet.</h2>
            <p>For now, you can take a quiz or manage your question library.</p>
            <button
              className="primary"
              onClick={() => {
                void navigate('quiz')
              }}
            >
              Go to Quiz
            </button>
          </section>
        </main>
      )}
      {page === 'importer' && <LibraryPage />}
    </div>
  )
}
