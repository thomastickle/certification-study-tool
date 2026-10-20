import { StudyIcon } from './StudyIcon.tsx'

type Props = { onNavigate: (page: 'quiz' | 'exam' | 'review' | 'importer') => void }

const sessions = [
  {
    mode: 'quiz',
    name: 'Quiz',
    description: 'A short session across the exam domains.',
    questions: '20 questions',
    duration: '20 minutes',
    action: 'Set up quiz',
  },
  {
    mode: 'exam',
    name: 'Practice exam',
    description: 'A full-length attempt with time to focus.',
    questions: '65 questions',
    duration: '90 minutes',
    action: 'Set up exam',
  },
  {
    mode: 'review',
    name: 'Due Review',
    description: 'Revisit questions scheduled for another check.',
    questions: 'Up to 20 questions',
    duration: '20 minutes',
    action: 'Set up review',
  },
] as const

/** Keep the starting screen focused on choosing the next study session. */
export function HomePage({ onNavigate }: Props) {
  return (
    <main className="home-page">
      <div className="page-heading">
        <div>
          <h1>Study workspace</h1>
          <p className="intro">Start a quiz, take an exam, or revisit due questions.</p>
        </div>
      </div>
      <section className="session-options" aria-label="Study sessions">
        {sessions.map((session) => (
          <article className="session-option" key={session.mode}>
            <span className="session-icon">
              <StudyIcon name={session.mode} />
            </span>
            <div className="session-description">
              <h2>{session.name}</h2>
              <p>{session.description}</p>
              <div className="session-format">
                <span>{session.questions}</span>
                <span>{session.duration}</span>
              </div>
            </div>
            <button
              className={session.mode === 'quiz' ? 'primary' : ''}
              onClick={() => onNavigate(session.mode)}
            >
              {session.action}
              <StudyIcon name="arrow" />
            </button>
          </article>
        ))}
      </section>
      <div className="home-library">
        <StudyIcon name="importer" />
        <div>
          <h2>Your question library</h2>
          <p>Import question banks and manage your sources.</p>
        </div>
        <button onClick={() => onNavigate('importer')}>
          Open library
          <StudyIcon name="arrow" />
        </button>
      </div>
    </main>
  )
}
