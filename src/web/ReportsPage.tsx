import { useEffect, useRef, useState } from 'react'
import type { StudyReport, ReportMode } from '../shared/report-contracts.ts'
import type { QuizView } from '../shared/quiz-contracts.ts'
import { studyReportMarkdown } from '../shared/report-export.ts'
import { quizReport } from '../shared/quiz-report.ts'
import { DeleteResultButton } from './ResultDeletion.tsx'
import { api } from './api.ts'
import type { Certification } from './certifications.ts'
import { ReportDashboard } from './ReportDashboard.tsx'
import { ReportAttemptReview } from './ReportAttemptReview.tsx'
import { DeletedBankLifetimeNotice } from './DeletedBankNotice.tsx'
import './reports.css'

/** Downloads a local Markdown artifact without sending study results anywhere. */
function download(text: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Loads one consistent filtered report, cancelling superseded requests. */
export function ReportsPage({ certification }: { certification: Certification }) {
  const [mode, setMode] = useState<ReportMode>('all')
  const [days, setDays] = useState('all')
  const [report, setReport] = useState<StudyReport>()
  const [attemptId, setAttemptId] = useState<string | null>(null)
  const [quiz, setQuiz] = useState<QuizView>()
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const heading = useRef<HTMLHeadingElement>(null)
  const returnAttemptId = useRef<string | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    setReport(undefined)
    setError('')
    const query = new URLSearchParams({
      mode,
      days,
      provider: certification.provider,
      certification: certification.code,
    })
    api<StudyReport>(`/reports?${query}`, {
      signal: controller.signal,
    })
      .then((value) => {
        if (!controller.signal.aborted) {
          setReport(value)
        }
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setError(reason instanceof Error ? reason.message : 'Could not load your report.')
        }
      })
    return () => controller.abort()
  }, [mode, days, retry, certification.provider, certification.code])
  useEffect(() => {
    if (!attemptId) {
      return
    }
    const controller = new AbortController()
    setQuiz(undefined)
    setError('')
    api<QuizView>(`/quizzes/${attemptId}`, { signal: controller.signal })
      .then((value) => {
        if (value.status !== 'completed') {
          throw new Error('Only completed attempts have reports.')
        }
        if (!controller.signal.aborted) {
          setQuiz(value)
        }
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setError(reason instanceof Error ? reason.message : 'Could not load this attempt.')
        }
      })
    return () => controller.abort()
  }, [attemptId, retry])
  useEffect(() => {
    if (attemptId) {
      if (quiz || error) {
        heading.current?.focus()
      }
      return
    }
    if (returnAttemptId.current && report) {
      const origin = document.getElementById(`report-attempt-${returnAttemptId.current}`)
      ;(origin ?? heading.current)?.focus()
      returnAttemptId.current = null
    }
  }, [attemptId, quiz, report, error])
  const modeLabels = { all: 'All practice', exam: 'Exams', quiz: 'Quizzes', review: 'Due Reviews' }
  const scope = `${modeLabels[mode]} · ${days === 'all' ? 'All time' : `Last ${days} days`}`

  /** Opens a new detail view at its heading, keeping dashboard filters intact. */
  function openAttempt(id: string): void {
    returnAttemptId.current = id
    setQuiz(undefined)
    setAttemptId(id)
    window.scrollTo({ top: 0, behavior: 'instant' })
  }

  /** Resolves loading and error states before presenting either report view. */
  function reportContent() {
    if (error) {
      return (
        <div className="report-load-state" role="alert">
          <h2>Your report couldn’t load.</h2>
          <p>{error}</p>
          <button onClick={() => setRetry(retry + 1)}>Try again</button>
        </div>
      )
    }
    if (attemptId) {
      if (quiz) {
        return (
          <>
            <DeleteResultButton
              id={quiz.id}
              onDeleted={() => {
                setAttemptId(null)
                setQuiz(undefined)
                setRetry((value) => value + 1)
              }}
            />
            <ReportAttemptReview key={quiz.id} quiz={quiz} />
          </>
        )
      }
      return (
        <div className="report-load-state" role="status">
          Opening your attempt…
        </div>
      )
    }
    if (!report) {
      return (
        <div className="report-load-state" role="status">
          Gathering your study story…
        </div>
      )
    }
    if (report.attempts.length) {
      return null
    }
    return (
      <section className="report-load-state report-empty">
        <span className="empty-report-icon" aria-hidden="true">
          ↗
        </span>
        <p className="eyebrow">A FRESH PERSPECTIVE STARTS HERE</p>
        <h2>
          {mode === 'all' && days === 'all'
            ? 'Your story is still being written.'
            : 'A clean slate in this view.'}
        </h2>
        <p>
          {mode === 'all' && days === 'all'
            ? 'Complete a quiz or exam and return to see your progress, domain strengths, and detailed answer reviews.'
            : 'There are no completed attempts for these filters. Try another mode or a wider time range.'}
        </p>
        {(mode !== 'all' || days !== 'all') && (
          <button
            onClick={() => {
              setMode('all')
              setDays('all')
            }}
          >
            Show all practice
          </button>
        )}
        <small>
          {certification.provider} · {certification.name} · {certification.code}
        </small>
      </section>
    )
  }

  return (
    <main className="reports-page">
      <div className="report-page-heading">
        <div>
          <p className="eyebrow">
            YOUR LEARNING, IN PERSPECTIVE <span className="report-live-dot" />
          </p>
          <h1 ref={heading} tabIndex={-1}>
            {attemptId ? 'A closer look at your progress.' : 'Look how far you’ve come.'}
          </h1>
          <p className="intro">
            {attemptId
              ? 'The answers, the insights, and your next step forward.'
              : 'Find your rhythm. Know your strengths. Make your next study session count.'}
          </p>
          <p>
            {certification.provider} · {certification.name} · {certification.code}
          </p>
        </div>
        <button
          className="report-export"
          disabled={attemptId ? !quiz : !report || !report.attempts.length}
          onClick={() => {
            if (attemptId && quiz) {
              download(quizReport(quiz), `${certification.code}-${quiz.id}.md`)
            } else if (report) {
              download(
                studyReportMarkdown(report, scope),
                `${certification.code}-${mode}-report.md`,
              )
            }
          }}
        >
          <span aria-hidden="true">↓</span> Export {attemptId ? 'attempt' : 'report'}
        </button>
      </div>
      {attemptId ? (
        <button
          className="back-to-reports"
          onClick={() => {
            setAttemptId(null)
            setError('')
          }}
        >
          ← Back to reports
        </button>
      ) : (
        <div className="report-toolbar">
          <div className="report-segments report-mode-switch" aria-label="Practice mode">
            {(
              [
                { value: 'all', label: 'Master report' },
                { value: 'quiz', label: 'Quizzes' },
                { value: 'exam', label: 'Exams' },
                { value: 'review', label: 'Due Reviews' },
              ] as const
            ).map((item) => (
              <button
                key={item.value}
                aria-pressed={mode === item.value}
                onClick={() => setMode(item.value)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="report-filter-group">
            <label>
              Time range
              <select value={days} onChange={(event) => setDays(event.target.value)}>
                <option value="all">All time</option>
                <option value="7">Last 7 days</option>
                <option value="30">Last 30 days</option>
                <option value="90">Last 90 days</option>
              </select>
            </label>
          </div>
        </div>
      )}
      <div hidden={!!attemptId || !!error}>
        {report && report.attempts.length === 0 && <DeletedBankLifetimeNotice report={report} />}
        {report && report.attempts.length > 0 && (
          <ReportDashboard key={`${mode}-${days}`} report={report} onOpenAttempt={openAttempt} />
        )}
      </div>
      {reportContent()}
    </main>
  )
}
