import { ResultCompletionHeader } from '../practice/ResultDeletion.tsx'
import { useResultFilters } from '../../shared/ui/ResultFilters.tsx'
import { ConceptLabels } from '../../shared/ui/ConceptLabels.tsx'
import { DeletedBankNotice } from '../../shared/ui/DeletedBankNotice.tsx'
import { AttemptTiming } from '../../shared/ui/AttemptTiming.tsx'
import { useState } from 'react'
import type { QuizView } from '../../../shared/quiz-contracts.ts'
import { percent, reportDate } from './ReportDashboard.tsx'

/** Describes skipped answers independently from the scoring outcome. */
function outcome(correct: boolean | undefined, answered: boolean): string {
  if (!answered) {
    return 'Skipped'
  }
  return correct ? 'Correct' : 'Incorrect'
}

/** Lets learners inspect the saved answer evidence behind an individual result. */
export function ReportAttemptReview({ quiz }: { quiz: QuizView }) {
  const { questions: filteredQuestions, controls: filterControls } = useResultFilters(
    quiz.questions,
  )
  const [domain, setDomain] = useState('all')
  const mode = quiz.mode ?? quiz.options.mode ?? 'quiz'
  const questions = filteredQuestions.filter(
    (question) => domain === 'all' || question.domain === Number(domain),
  )
  const clf =
    (quiz.options.provider ?? 'AWS') === 'AWS' &&
    (quiz.options.certification ?? 'CLF-C02') === 'CLF-C02'
  const domains = clf
    ? [
        { id: 1, name: 'Cloud Concepts' },
        { id: 2, name: 'Security and Compliance' },
        { id: 3, name: 'Cloud Technology and Services' },
        { id: 4, name: 'Billing, Pricing, and Support' },
      ]
    : [{ id: 0, name: 'Domain not mapped' }]
  const answered = quiz.questions.filter((q) => q.selected.length).length
  const score = quiz.total ? (quiz.correctCount! / quiz.total) * 100 : null
  return (
    <>
      <DeletedBankNotice names={quiz.deletedBankNames} />
      <section className="attempt-summary report-panel">
        <ResultCompletionHeader
          quiz={quiz}
          label={`${mode.toUpperCase()} · ${reportDate(quiz.finishedAt!)} · ${quiz.options.certification ?? 'CLF-C02'}`}
        />
        <div className="attempt-summary-content">
          <div>
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
              {percent(answered ? (quiz.correctCount! / answered) * 100 : null)} · {answered}{' '}
              answered · {quiz.total - answered} skipped
            </p>
          </div>
          <div className="attempt-score-large">
            <strong>{percent(score)}</strong>
            <span>Score</span>
            <span>
              {quiz.correctCount}/{quiz.total} correct
            </span>
          </div>
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
          {domains.map(({ id, name }) => {
            const group = quiz.questions.filter((q) => q.domain === id)
            const answered = group.filter((q) => q.selected.length).length
            const correct = group.filter((q) => q.correct).length
            return (
              <article className="domain-card" key={name}>
                <span className="domain-number">{id ? `0${id}` : '—'}</span>
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
              {domains.map(({ id, name }) => (
                <option value={id} key={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        </div>
        {filterControls}
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
                {domains.find((item) => item.id === question.domain)?.name ?? 'Domain not mapped'} ·{' '}
                {question.area ?? 'Unclassified'} · {question.topic ?? 'Unclassified'}
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
