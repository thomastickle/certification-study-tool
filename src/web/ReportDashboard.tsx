import { useState } from 'react'
import { progressChart } from './report-state.ts'
import type { ReportCounts, StudyReport } from '../shared/report-contracts.ts'

/** Formats an absent measurement separately from a measured zero. */
export function percent(value: number | null): string {
  return value === null ? '—' : `${Math.round(value)}%`
}

/** Uses UTC throughout daily charts so browser time zones cannot move study activity. */
export function reportDate(value: number | string): string {
  return new Date(value).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

/** Shows both denominators alongside a compact outcome bar. */
function OutcomeBar({ counts }: { counts: ReportCounts }) {
  return (
    <div
      className="outcome-bar"
      aria-label={`${counts.correct} correct, ${counts.incorrect} incorrect, ${counts.skipped} skipped`}
    >
      <span style={{ width: `${counts.total ? (counts.correct / counts.total) * 100 : 0}%` }} />
      <span style={{ width: `${counts.total ? (counts.incorrect / counts.total) * 100 : 0}%` }} />
    </div>
  )
}

/** Plots cumulative correct answers or daily answered-question accuracy on a real time axis. */
function ProgressChart({ report }: { report: StudyReport }) {
  const [metric, setMetric] = useState<'correct' | 'accuracy'>('correct')
  const { points, max } = progressChart(report.timeline, metric)
  const line = points.map((point) => `${point.x},${point.y}`).join(' ')
  const start = points[0]
  const end = points.at(-1)
  return (
    <section className="progress-card" aria-labelledby="progress-heading">
      <div className="report-card-heading">
        <div>
          <p className="eyebrow">THE BIG PICTURE</p>
          <h2 id="progress-heading">Small steps. Lasting progress.</h2>
        </div>
        <div className="chart-switch" aria-label="Chart metric">
          <button aria-pressed={metric === 'correct'} onClick={() => setMetric('correct')}>
            Correct answers
          </button>
          <button aria-pressed={metric === 'accuracy'} onClick={() => setMetric('accuracy')}>
            Accuracy
          </button>
        </div>
      </div>
      <p className="chart-caption">
        {metric === 'correct'
          ? 'Cumulative correct answers'
          : 'Daily accuracy on answered questions'}{' '}
        · UTC
      </p>
      <svg
        className="progress-chart"
        viewBox="0 0 720 218"
        role="img"
        aria-label={
          metric === 'correct'
            ? `Cumulative correct answers: ${report.counts.correct}. Daily values in chart data below.`
            : 'Daily answered-question accuracy. Values in chart data below.'
        }
      >
        <defs>
          <linearGradient id="progress-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#cce8a6" stopOpacity="0.24" />
            <stop offset="100%" stopColor="#cce8a6" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 0.5, 1].map((fraction) => (
          <g key={fraction}>
            <line
              x1="48"
              x2="686"
              y1={180 - fraction * 145}
              y2={180 - fraction * 145}
              stroke="#476355"
              strokeDasharray="3 6"
            />
            <text x="32" y={184 - fraction * 145} textAnchor="end">
              {Math.round(fraction * max)}
              {metric === 'accuracy' ? '%' : ''}
            </text>
          </g>
        ))}
        {metric === 'accuracy' && (
          <g>
            <line x1="48" x2="686" y1="64" y2="64" stroke="#ebc78c" strokeDasharray="5 5" />
            <text x="680" y="55" textAnchor="end" className="chart-target">
              80% practice target
            </text>
          </g>
        )}
        {start && end && (
          <polygon points={`${start.x},180 ${line} ${end.x},180`} fill="url(#progress-fill)" />
        )}
        <polyline
          points={line}
          fill="none"
          stroke="#d4edb3"
          strokeWidth="3"
          strokeLinejoin="round"
        />
        {points.map((point) => (
          <circle key={point.date} cx={point.x} cy={point.y} r="4" fill="#e2f3c7">
            <title>
              {point.date}: {point.counts.correct} correct / {point.counts.answered} answered;{' '}
              {point.counts.skipped} skipped
            </title>
          </circle>
        ))}
        {start && (
          <text x="48" y="211">
            {reportDate(start.date)}
          </text>
        )}
        {end && points.length > 1 && (
          <text x="680" y="211" textAnchor="end">
            {reportDate(end.date)}
          </text>
        )}
      </svg>
      <details className="chart-data">
        <summary>
          View chart data <span>↗</span>
        </summary>
        <div className="report-table-scroll">
          <table>
            <caption>Daily activity (UTC)</caption>
            <thead>
              <tr>
                <th>Date</th>
                <th>Correct</th>
                <th>Answered</th>
                <th>Skipped</th>
                <th>Accuracy</th>
              </tr>
            </thead>
            <tbody>
              {report.timeline.map((day) => (
                <tr key={day.date}>
                  <td>{day.date}</td>
                  <td>{day.counts.correct}</td>
                  <td>{day.counts.answered}</td>
                  <td>{day.counts.skipped}</td>
                  <td>{percent(day.counts.accuracy)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  )
}

/** Presents the same filtered evidence as summary, domain details and attempt history. */
export function ReportDashboard({
  report,
  onOpenAttempt,
}: {
  report: StudyReport
  onOpenAttempt: (id: string) => void
}) {
  const [domainView, setDomainView] = useState<'summary' | 'detail'>('summary')
  const [historyPage, setHistoryPage] = useState(0)
  const counts = report.counts
  const studied = report.domains.filter((domain) => domain.counts.answered > 0)
  const weakest = [...studied].sort((a, b) => a.counts.accuracy! - b.counts.accuracy!)[0]
  return (
    <>
      <section className="report-stats" aria-label="Performance summary">
        <div>
          <span className="stat-label">
            Correct answers <span>↗</span>
          </span>
          <strong>
            {counts.correct.toLocaleString()}
            <small> / {counts.total.toLocaleString()}</small>
          </strong>
          <p>Across all question appearances</p>
        </div>
        <div>
          <span className="stat-label">
            Answer accuracy <span>◎</span>
          </span>
          <strong>{percent(counts.accuracy)}</strong>
          <p>
            {counts.answered} answered · {counts.skipped} skipped
          </p>
        </div>
        <div>
          <span className="stat-label">
            Practice target met <span>⚑</span>
          </span>
          <strong>
            {report.passingAttempts}
            <small> / {report.attempts.length} attempts</small>
          </strong>
          <p>At least 80% of all questions correct</p>
        </div>
        <div>
          <span className="stat-label">
            Domains explored <span>◈</span>
          </span>
          <strong>
            {studied.length}
            <small> / 4 domains</small>
          </strong>
          <p>Every answer builds the picture</p>
        </div>
      </section>
      <div className="report-feature-grid">
        <ProgressChart report={report} />
        <aside className="focus-card">
          <span className="focus-icon" aria-hidden="true">
            ✧
          </span>
          <p className="eyebrow">YOUR NEXT CHAPTER</p>
          <h2>{weakest ? weakest.name : 'Make your first mark.'}</h2>
          <p>
            {weakest
              ? `Your lowest answered-question accuracy is ${percent(weakest.counts.accuracy)} here, based on ${weakest.counts.answered} answers. A focused review is a useful next step.`
              : 'Answer a few questions to discover where a little extra practice can help.'}
          </p>
          <div className="focus-footnote">
            {weakest
              ? `${weakest.counts.correct} correct · ${weakest.counts.incorrect} incorrect · ${weakest.counts.skipped} skipped`
              : 'Your study story starts with an answer.'}
          </div>
          <small>Practice evidence, not an official exam score or readiness prediction.</small>
        </aside>
      </div>
      <section className="report-panel" aria-labelledby="domains-heading">
        <div className="report-card-heading">
          <div>
            <p className="eyebrow">KNOW YOUR STRENGTHS</p>
            <h2 id="domains-heading">A clearer view of every domain.</h2>
          </div>
          <div className="report-segments" aria-label="Domain view">
            <button
              aria-pressed={domainView === 'summary'}
              onClick={() => setDomainView('summary')}
            >
              Summary
            </button>
            <button aria-pressed={domainView === 'detail'} onClick={() => setDomainView('detail')}>
              Study details
            </button>
          </div>
        </div>
        <p className="report-muted">
          Accuracy uses answered questions. The marker is your 80% practice target.
        </p>
        {domainView === 'summary' ? (
          <div className="domain-grid">
            {report.domains.map((domain) => (
              <article className="domain-card" key={domain.id}>
                <div className="domain-card-top">
                  <span className="domain-number">0{domain.domain}</span>
                  <strong>{percent(domain.counts.accuracy)}</strong>
                </div>
                <h3>{domain.name}</h3>
                <div className="domain-meter">
                  <span style={{ width: `${domain.counts.accuracy ?? 0}%` }} />
                  <i />
                </div>
                <p>
                  {domain.counts.answered
                    ? `${domain.counts.correct} of ${domain.counts.answered} answered correctly`
                    : 'No answers in this domain yet'}
                </p>
                <span className="domain-note">
                  {domain.counts.skipped} skipped · {domain.counts.total} appearances
                </span>
              </article>
            ))}
          </div>
        ) : (
          <div className="report-table-scroll">
            <table className="report-table">
              <caption className="sr-only">Domain, study area and topic performance</caption>
              <thead>
                <tr>
                  <th>Domain / study area / topic</th>
                  <th>Correct</th>
                  <th>Incorrect</th>
                  <th>Skipped</th>
                  <th>Accuracy</th>
                </tr>
              </thead>
              <tbody>
                {report.domains.map((domain) => (
                  <DomainRows key={domain.id} report={report} domain={domain.domain} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <div className="report-bottom-grid">
        <section className="report-panel confidence-panel" aria-labelledby="confidence-heading">
          <p className="eyebrow">CHECK YOUR INSTINCTS</p>
          <h2 id="confidence-heading">Confidence meets reality.</h2>
          <p className="report-muted">See how certainty lines up with correctness.</p>
          {report.confidence.map((group) => (
            <div className="confidence-row" key={group.name}>
              <div>
                <span>{group.name}</span>
                <strong>{percent(group.counts.accuracy)}</strong>
              </div>
              <OutcomeBar counts={group.counts} />
              <small>
                {group.counts.correct} correct / {group.counts.answered} answered ·{' '}
                {group.counts.skipped} skipped
              </small>
            </div>
          ))}
          <div className="outcome-legend">
            <span>Correct</span>
            <span>Incorrect</span>
            <span>Skipped</span>
          </div>
        </section>
        <section className="report-panel history-panel" aria-labelledby="history-heading">
          <div className="report-card-heading">
            <div>
              <p className="eyebrow">EVERY ATTEMPT COUNTS</p>
              <h2 id="history-heading">Your study journal.</h2>
            </div>
            <span className="report-count">{report.attempts.length} completed</span>
          </div>
          <div className="attempt-list">
            {report.attempts.slice(historyPage * 8, historyPage * 8 + 8).map((attempt) => (
              <button
                className="attempt-row"
                id={`report-attempt-${attempt.id}`}
                key={attempt.id}
                onClick={() => onOpenAttempt(attempt.id)}
              >
                <span className={`attempt-icon ${attempt.mode}`} aria-hidden="true">
                  {attempt.mode === 'exam' ? 'E' : 'Q'}
                </span>
                <span className="attempt-title">
                  <strong>{attempt.mode === 'exam' ? 'Practice exam' : 'Practice quiz'}</strong>
                  <small>
                    {reportDate(attempt.finishedAt)} ·{' '}
                    {new Date(attempt.finishedAt).toLocaleTimeString('en-US', {
                      hour: 'numeric',
                      minute: '2-digit',
                      timeZone: 'UTC',
                    })}{' '}
                    UTC · {Math.round(attempt.durationMs / 60000)} min
                  </small>
                </span>
                <span className="attempt-score">
                  <strong>{percent(attempt.counts.score)}</strong>
                  <small>
                    {attempt.counts.correct}/{attempt.counts.total} correct
                  </small>
                </span>
                <span className={`attempt-status ${attempt.passed ? 'met' : ''}`}>
                  {attempt.passed ? 'Target met' : 'Keep building'}
                </span>
                <span aria-hidden="true">↗</span>
              </button>
            ))}
          </div>
          {report.attempts.length > 8 && (
            <div className="history-pagination">
              <button disabled={historyPage === 0} onClick={() => setHistoryPage(historyPage - 1)}>
                Previous
              </button>
              <span>
                Page {historyPage + 1} of {Math.ceil(report.attempts.length / 8)}
              </span>
              <button
                disabled={(historyPage + 1) * 8 >= report.attempts.length}
                onClick={() => setHistoryPage(historyPage + 1)}
              >
                Next
              </button>
            </div>
          )}
        </section>
      </div>
      <p className="report-method">
        Completed attempts only · Repeat questions count each time · Raw practice scores, not AWS
        scaled scores · All activity stays in your local workspace
      </p>
    </>
  )
}

/** Keeps domain totals and their saved study classifications next to one another. */
function DomainRows({ report, domain }: { report: StudyReport; domain: number }) {
  const group = report.domains.find((item) => item.domain === domain)!
  const topics = report.topics.filter((topic) => topic.domain === domain)
  return (
    <>
      <tr className="domain-total">
        <th scope="row">
          0{domain} · {group.name}
        </th>
        <td>{group.counts.correct}</td>
        <td>{group.counts.incorrect}</td>
        <td>{group.counts.skipped}</td>
        <td>{percent(group.counts.accuracy)}</td>
      </tr>
      {topics.map((topic) => (
        <tr key={topic.id}>
          <th scope="row" className="topic-name">
            {topic.name}
          </th>
          <td>{topic.counts.correct}</td>
          <td>{topic.counts.incorrect}</td>
          <td>{topic.counts.skipped}</td>
          <td>{percent(topic.counts.accuracy)}</td>
        </tr>
      ))}
    </>
  )
}
