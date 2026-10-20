type Destination = 'quiz' | 'exam' | 'review' | 'reports' | 'importer'

type Props = { onNavigate: (page: Destination) => void }

const practiceOptions = [
  {
    page: 'quiz',
    title: 'Daily practice',
    detail: 'A focused session with answers and explanations to review afterward.',
    format: '20 questions · 20 minutes',
    action: 'Set up a quiz',
  },
  {
    page: 'exam',
    title: 'Practice exam',
    detail: 'Work through a full timed attempt across the exam domains.',
    format: '65 questions · 90 minutes',
    action: 'Set up an exam',
  },
  {
    page: 'review',
    title: 'Retention review',
    detail: 'Return to questions that are due for another check.',
    format: 'Due questions',
    action: 'Review due questions',
  },
] as const

/** Make the supported certification and the next study action immediately visible. */
export function HomePage({ onNavigate }: Props) {
  return (
    <main className="home-page">
      <section className="certification-overview" aria-labelledby="certification-title">
        <div className="certification-title">
          <p className="home-kicker">AMAZON WEB SERVICES / FOUNDATIONAL</p>
          <h1 id="certification-title">Cloud Practitioner</h1>
          <p className="home-intro">
            Your workspace for the AWS Certified Cloud Practitioner exam.
            <br />
            Practice, revisit what you’ve learned, and track your progress.
          </p>
          <button className="home-primary" onClick={() => onNavigate('quiz')}>
            Set up a quiz <span aria-hidden="true">↗</span>
          </button>
        </div>
        <aside className="exam-brief" aria-label="Practice exam format">
          <p className="home-kicker">YOUR CERTIFICATION</p>
          <p className="exam-brief-code">CLF-C02</p>
          <p className="exam-brief-name">
            AWS Certified <br />
            Cloud Practitioner
          </p>
          <dl>
            <div>
              <dt>Practice exam</dt>
              <dd>65 questions</dd>
            </div>
            <div>
              <dt>Time allowed</dt>
              <dd>90 minutes</dd>
            </div>
            <div>
              <dt>Level</dt>
              <dd>Foundational</dd>
            </div>
          </dl>
        </aside>
      </section>

      <section className="study-options" aria-labelledby="study-options-title">
        <div className="study-options-heading">
          <h2 id="study-options-title">Make time to study.</h2>
          <span>Choose your session</span>
        </div>
        {practiceOptions.map((option, index) => (
          <div className="study-option" key={option.page}>
            <span className="study-option-number" aria-hidden="true">
              0{index + 1}
            </span>
            <div className="study-option-description">
              <h3>{option.title}</h3>
              <p>{option.detail}</p>
            </div>
            <span className="study-option-format">{option.format}</span>
            <button onClick={() => onNavigate(option.page)}>
              {option.action} <span aria-hidden="true">→</span>
            </button>
          </div>
        ))}
      </section>

      <section className="workspace-tools" aria-label="Workspace tools">
        <div>
          <h2>See how you’re doing</h2>
          <p>Scores, domain strengths, and past attempts.</p>
          <button onClick={() => onNavigate('reports')}>
            View reports <span aria-hidden="true">→</span>
          </button>
        </div>
        <div>
          <h2>Build your question library</h2>
          <p>Import question banks and manage your sources.</p>
          <button onClick={() => onNavigate('importer')}>
            Manage question banks <span aria-hidden="true">→</span>
          </button>
        </div>
      </section>
      <p className="home-scope-note">
        Practice currently supports AWS Cloud Practitioner (CLF-C02). Your library can also hold
        question banks for other certifications.
      </p>
    </main>
  )
}
