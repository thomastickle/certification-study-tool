import type { HomeSummary, ReadinessStatus } from '../shared/home-contracts.ts'
import { StudyIcon } from './StudyIcon.tsx'

export type HomeNavigation = 'practice' | 'review' | 'importer' | 'certifications'

type Props = {
  summary: HomeSummary
  onNavigate: (page: HomeNavigation) => void
  onPractice: (sourceIds: number[]) => void
}

const readinessLabels: Record<ReadinessStatus, string> = {
  insufficient: 'Needs more data',
  unsupported: 'Not yet supported',
  red: 'Needs work',
  yellow: 'Borderline',
  green: 'Exam-ready',
}

/** Show compact provider summaries and explain how each real track is progressing. */
export function HomeDashboard({ summary, onNavigate, onPractice }: Props) {
  const totalTracks = summary.providers.reduce((total, provider) => total + provider.total, 0)
  const readyTracks = summary.providers.reduce((total, provider) => total + provider.ready, 0)

  return (
    <main className="home-page">
      <div className="page-heading home-heading">
        <div>
          <h1>Certification readiness</h1>
          <p className="intro">
            {readyTracks} / {totalTracks} tracks exam-ready
          </p>
        </div>
        <button className="quiet-button" onClick={() => onNavigate('certifications')}>
          Manage certifications
        </button>
      </div>
      <div
        className="summary-progress"
        role="progressbar"
        aria-label="Tracks exam-ready"
        aria-valuemin={0}
        aria-valuemax={totalTracks || 1}
        aria-valuenow={readyTracks}
      >
        <span style={{ width: `${totalTracks ? (readyTracks / totalTracks) * 100 : 0}%` }} />
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
          {summary.providers.map((provider) => (
            <article className="provider-card" key={provider.name}>
              <header className="provider-heading">
                <div>
                  <h2>{provider.name}</h2>
                  <span>
                    {provider.ready} of {provider.total} exam-ready
                  </span>
                </div>
                <span className="provider-due">{provider.dueCount} due</span>
              </header>
              <div className="track-list">
                {provider.certifications.map((certification) => {
                  const { readiness } = certification
                  const canPractice =
                    certification.provider === 'AWS' && certification.code === 'CLF-C02'
                  return (
                    <section className="track-row" key={certification.code}>
                      <div className="track-line">
                        <div className="track-name">
                          <strong>{certification.name}</strong>
                          <code>{certification.code}</code>
                          {certification.earned && (
                            <span className="earned-star" aria-label="Earned certification">
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
                      <details className="readiness-evidence">
                        <summary>Readiness details</summary>
                        <ul>
                          {readiness.reasons.map((reason) => (
                            <li key={reason}>{reason}</li>
                          ))}
                          {readiness.domains
                            .filter((domain) => domain.score !== null)
                            .map((domain) => (
                              <li key={domain.name}>
                                {domain.name}: {domain.score}%
                              </li>
                            ))}
                        </ul>
                      </details>
                      {canPractice && (
                        <div className="track-actions">
                          <button onClick={() => onPractice(certification.sourceIds)}>
                            Practice
                          </button>
                          {certification.dueCount > 0 && (
                            <button className="quiet-button" onClick={() => onNavigate('review')}>
                              Review due
                            </button>
                          )}
                        </div>
                      )}
                    </section>
                  )
                })}
              </div>
            </article>
          ))}
        </section>
      )}
    </main>
  )
}
