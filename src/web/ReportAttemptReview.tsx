import { ConceptLabels } from './ConceptLabels.tsx'
import { AttemptTiming } from './AttemptTiming.tsx'
import { useState } from 'react'
import type { QuizView } from '../shared/quiz-contracts.ts'
import { percent, reportDate } from './ReportDashboard.tsx'

type AnswerFilter = 'all' | 'incorrect' | 'skipped' | 'flagged'

/** Describes skipped answers independently from the scoring outcome. */
function outcome(correct: boolean | undefined, answered: boolean): string {
  if (!answered) {
    return 'Skipped'
  }
  return correct ? 'Correct' : 'Incorrect'
}

/** Lets learners inspect the saved answer evidence behind an individual result. */
export function ReportAttemptReview({ quiz }: { quiz: QuizView }) {
  const [filter, setFilter] = useState<AnswerFilter>('all')
  const [domain, setDomain] = useState('all')
  const mode = quiz.mode ?? quiz.options.mode ?? 'quiz'
  const questions = quiz.questions.filter((question) => {
    if (domain !== 'all' && question.domain !== Number(domain)) {
      return false
    }
    if (filter === 'incorrect') {
      return question.selected.length > 0 && !question.correct
    }
    if (filter === 'skipped') {
      return question.selected.length === 0
    }
    if (filter === 'flagged') {
      return question.flagged
    }
    return true
  })
  const domainNames = [
    'Cloud Concepts',
    'Security and Compliance',
    'Cloud Technology and Services',
    'Billing, Pricing, and Support',
  ]
  const answered = quiz.questions.filter((q) => q.selected.length).length
  const score = quiz.total ? (quiz.correctCount! / quiz.total) * 100 : null
  return (
    <>
      <section className="attempt-summary report-panel">
        <div>
          <p className="eyebrow">
            {mode.toUpperCase()} · {reportDate(quiz.finishedAt!)} · CLF-C02
          </p>
          <h2>
            {score !== null && score >= 80
              ? 'A milestone worth keeping.'
              : 'Every attempt is a step forward.'}
          </h2>
          <p>
            {quiz.correctCount} correct · {answered - quiz.correctCount!} incorrect ·{' '}
            {quiz.total - answered} skipped
          </p>
          <p className="report-muted">
            Score includes skipped questions.{' '}
            {mode === 'review' ? 'Due Review · no pass target.' : 'Practice target: 80%.'}
          </p>
          <p className="report-muted">
            Accuracy on answered questions:{' '}
            {percent(answered ? (quiz.correctCount! / answered) * 100 : null)} · {answered} answered
            · {quiz.total - answered} skipped
          </p>
        </div>
        <div className="attempt-score-large">
          <strong>{percent(score)}</strong>
          <span>Score</span>
          <span>
            {quiz.correctCount}/{quiz.total} correct
          </span>
        </div>
      </section>
      <section className="report-panel">
        <AttemptTiming quiz={quiz} />
      </section>
      <section className="report-panel">
        <div className="report-card-heading">
          <div>
            <p className="eyebrow">THE DOMAIN BREAKDOWN</p>
            <h2>Where this attempt landed.</h2>
          </div>
        </div>
        <div className="domain-grid">
          {domainNames.map((name, i) => {
            const group = quiz.questions.filter((q) => q.domain === i + 1)
            const answered = group.filter((q) => q.selected.length).length
            const correct = group.filter((q) => q.correct).length
            return (
              <article className="domain-card" key={name}>
                <span className="domain-number">0{i + 1}</span>
                <h3>{name}</h3>
                <strong>{percent(group.length ? (correct / group.length) * 100 : null)}</strong>
                <p>
                  {correct}/{group.length} questions correct · {group.length - answered} skipped
                </p>
              </article>
            )
          })}
        </div>
      </section>
      <section className="report-panel answer-review" aria-labelledby="answers-heading">
        <div className="report-card-heading">
          <div>
            <p className="eyebrow">LEARN FROM THE DETAILS</p>
            <h2 id="answers-heading">Your answers, in focus.</h2>
          </div>
          <label>
            Domain
            <select value={domain} onChange={(event) => setDomain(event.target.value)}>
              <option value="all">All domains</option>
              {domainNames.map((name, i) => (
                <option value={i + 1} key={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="report-segments answer-filters" aria-label="Answer review filter">
          {(['all', 'incorrect', 'skipped', 'flagged'] as const).map((value) => (
            <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>
              {value === 'all' ? 'All questions' : value[0]!.toUpperCase() + value.slice(1)}
            </button>
          ))}
        </div>
        <p className="report-muted">
          Showing {questions.length} of {quiz.total} questions
        </p>
        {questions.length === 0 && (
          <p className="report-empty-inline">No questions match these filters.</p>
        )}
        {questions.map((question) => (
          <details className="answer-detail" key={question.questionId}>
            <summary>
              <span className={`answer-outcome ${question.correct ? 'correct' : 'missed'}`}>
                {outcome(question.correct, question.selected.length > 0)}
              </span>
              <span>
                <small>
                  QUESTION {question.questionId + 1} · DOMAIN {question.domain}
                  {question.flagged ? ' · FLAGGED' : ''}
                </small>
                <strong>{question.question}</strong>
              </span>
              <span aria-hidden="true">+</span>
            </summary>
            <div className="answer-detail-body">
              <p className="report-muted">
                {domainNames[question.domain - 1]} · {question.area ?? 'Unclassified'} ·{' '}
                {question.topic ?? 'Unclassified'}
              </p>
              <ConceptLabels question={question} />
              <ul className="review-choices">
                {question.answers.map((answer) => (
                  <li
                    key={answer.id}
                    className={question.correctAnswerIds?.includes(answer.id) ? 'is-correct' : ''}
                  >
                    <span>{String.fromCharCode(65 + answer.id)}.</span>
                    <span>{answer.text}</span>
                    <small>
                      {question.correctAnswerIds?.includes(answer.id) ? 'Correct answer' : ''}
                      {question.selected.includes(answer.id) ? ' · Your selection' : ''}
                    </small>
                  </li>
                ))}
              </ul>
              {question.selected.length === 0 && <p>You left this question unanswered.</p>}
              <div className="answer-provenance">
                <span>Confidence: {question.confidence ?? 'Not recorded'}</span>
                <span>
                  Source: {question.sourceName} ({question.sourceKind}) · {question.reference}
                </span>
              </div>
            </div>
          </details>
        ))}
      </section>
    </>
  )
}
