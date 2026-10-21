import type {
  CertificationProgress,
  HomeSummary,
  ReadinessStatus,
} from '../shared/home-contracts.ts'
import { readinessThresholds } from '../shared/home-contracts.ts'
import { StudyIcon } from './StudyIcon.tsx'

export type HomeNavigation = 'practice' | 'review' | 'importer' | 'certifications'

type Props = {
  summary: HomeSummary
  onNavigate: (page: HomeNavigation) => void
  onPractice: (track: CertificationProgress) => void
  onReview: (track: CertificationProgress) => void
}

const readinessLabels: Record<ReadinessStatus, string> = {
  insufficient: 'Needs more data',
  unsupported: 'Not yet supported',
  red: 'Needs work',
  yellow: 'Borderline',
  green: 'Exam-ready',
}

/** Keep component percentages readable without rounding eligibility decisions. */
function percent(value: number | null): string {
  return value === null ? 'Not assessed' : `${Number(value.toFixed(1))}%`
}

/** Show compact provider summaries and explain how each real track is progressing. */
export function HomeDashboard({ summary, onNavigate, onPractice, onReview }: Props) {
  return (
    <main className="home-page">
      <div className="page-heading home-heading">
        <div>
          <h1>Certification readiness</h1>
          <p className="intro">Your study tracks, at a glance.</p>
        </div>
        <button className="quiet-button" onClick={() => onNavigate('certifications')}>
          Manage certifications
        </button>
      </div>
      {summary.providers.length === 0 ? (
        <section className="home-empty">
          <h2>No certification tracks yet</h2>
          <p>Import a question bank to start tracking your readiness.</p>
          <button onClick={() => onNavigate('importer')}>
            Import a bank <StudyIcon name="arrow" />
          </button>
        </section>
      ) : (
        <section className="provider-list" aria-label="Certification readiness by provider">
          {summary.providers.map((provider) => {
            const practice = provider.certifications.find((track) => track.sourceIds.length)
            const review = provider.certifications.find(
              (track) => track.dueCount > 0 && track.sourceIds.length,
            )
            return (
              <article className="provider-card" key={provider.name}>
                <header className="provider-heading">
                  <div>
                    <h2>{provider.name}</h2>
                    <span>
                      {provider.ready} / {provider.total} tracks exam-ready
                    </span>
                  </div>
                </header>
                <div
                  className="summary-progress"
                  role="progressbar"
                  aria-label={`${provider.name} tracks exam-ready`}
                  aria-valuemin={0}
                  aria-valuemax={provider.total}
                  aria-valuenow={provider.ready}
                >
                  <span style={{ width: `${(provider.ready / provider.total) * 100}%` }} />
                </div>
                <div className="track-list">
                  {provider.certifications.map((certification) => {
                    const { readiness } = certification
                    return (
                      <section className="track-row" key={certification.code}>
                        <div className="track-line">
                          <div className="track-name">
                            <strong>
                              {certification.sourceIds.length ? (
                                <button
                                  className="track-launch"
                                  aria-label={`Practice ${certification.name} (${certification.code})`}
                                  onClick={() => onPractice(certification)}
                                >
                                  {certification.name}
                                </button>
                              ) : (
                                certification.name
                              )}
                            </strong>
                            <code>{certification.code}</code>
                            {certification.earned && (
                              <span
                                className="earned-star"
                                role="img"
                                aria-label="Earned certification"
                              >
                                ★
                              </span>
                            )}
                          </div>
                          <div className="track-result">
                            <span>{readiness.score === null ? '—' : `${readiness.score}%`}</span>
                            <span className={`readiness-label readiness-${readiness.status}`}>
                              {readinessLabels[readiness.status]}
                            </span>
                          </div>
                        </div>
                        <div
                          className={`readiness-track readiness-${readiness.status}${readiness.score === null ? ' readiness-neutral' : ''}`}
                          role="progressbar"
                          aria-label={`${certification.code} readiness`}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuenow={readiness.score ?? undefined}
                          aria-valuetext={
                            readiness.score === null
                              ? readinessLabels[readiness.status]
                              : `${readiness.score}% ${readinessLabels[readiness.status]}`
                          }
                        >
                          <span style={{ width: `${readiness.score ?? 0}%` }} />
                        </div>
                        {Boolean(certification.deletedBankAttemptCount) && (
                          <p className="deleted-bank-notice">
                            {certification.deletedBankAttemptCount} saved{' '}
                            {certification.deletedBankAttemptCount === 1
                              ? 'attempt uses'
                              : 'attempts use'}{' '}
                            deleted question banks. Still included in readiness and study history.
                          </p>
                        )}
                        <details className="readiness-evidence">
                          <summary>Readiness details</summary>
                          <ul>
                            {readiness.reasons.map((reason) => (
                              <li key={reason}>{reason}</li>
                            ))}
                            {readiness.mastery !== null && (
                              <li>Mastery: {percent(readiness.mastery)}</li>
                            )}
                            {readiness.examAverage !== null && (
                              <li>Assessed exam average: {percent(readiness.examAverage)}</li>
                            )}
                            {readiness.exams.length > 0 && (
                              <li>
                                Assessed exam scores:{' '}
                                {readiness.exams.map((exam) => percent(exam.score)).join(', ')}
                              </li>
                            )}
                            {readiness.blendedScore !== null && (
                              <li>
                                Blended score before readiness limits: {readiness.blendedScore}%
                              </li>
                            )}
                            {readiness.domains
                              .filter((domain) => domain.score !== null)
                              .map((domain) => (
                                <li key={domain.name}>
                                  {domain.name}: {percent(domain.score)} · {domain.distinctAnswered}{' '}
                                  distinct questions answered
                                </li>
                              ))}
                          </ul>
                          {certification.dueCount > 0 && certification.sourceIds.length > 0 && (
                            <button onClick={() => onReview(certification)}>
                              Review due ({certification.dueCount})
                            </button>
                          )}
                        </details>
                      </section>
                    )
                  })}
                </div>
                <footer className="provider-actions">
                  <span>{provider.dueCount} questions due for review</span>
                  <div>
                    {practice && (
                      <button onClick={() => onPractice(practice)}>Practice {practice.code}</button>
                    )}
                    {review && (
                      <button className="quiet-button" onClick={() => onReview(review)}>
                        Review {review.code}
                      </button>
                    )}
                    {!practice && (
                      <button className="quiet-button" onClick={() => onNavigate('importer')}>
                        Open library
                      </button>
                    )}
                  </div>
                </footer>
              </article>
            )
          })}
        </section>
      )}
      {summary.providers.length > 0 && (
        <details className="readiness-method">
          <summary>How readiness works</summary>
          <p>
            The initial score blends 50% recent exam performance, 25% current mastery, and 25%
            weakest-domain performance. Green also requires {readinessThresholds.ready}% in every
            component and each assessed exam.
          </p>
          <p>
            Assessment needs 20 distinct answered questions per domain and varied, uninterrupted
            full exams on three study days within 30 days. Readiness is a study guide, not a
            guarantee of an official pass.
          </p>
        </details>
      )}
    </main>
  )
}
