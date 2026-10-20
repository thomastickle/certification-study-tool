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
  exam: 'Take a 65-question, 90-minute practice exam.',
  reports: 'Explore your progress, domain strengths, and every attempt.',
  importer: 'Manage your question library and sources.',
}

export function App() {
  const [page, setPage] = useState<Page>('home')
  const leaveQuiz = useRef<() => Promise<boolean>>(async () => true)

  async function navigate(next: Page) {
    if ((page === 'quiz' || page === 'exam') && next !== page && !(await leaveQuiz.current())) {
      return
    }
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
                <span className="home-card-action">Open →</span>
              </button>
            ))}
          </section>
        </main>
      )}
      {(page === 'quiz' || page === 'exam') && (
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
