import { useState } from 'react'
import type { QuizQuestion } from '../../../shared/quiz-contracts.ts'
import {
  filterResultQuestions,
  resultSourceKey,
  type ResultFilters,
} from '../lib/result-filters.ts'

/** Shares filter behavior between completion screens and historical attempt reports. */
export function useResultFilters(questions: QuizQuestion[]) {
  const [filters, setFilters] = useState<ResultFilters>({
    answer: 'all',
    confidence: 'all',
    source: 'all',
  })
  return {
    questions: filterResultQuestions(questions, filters),
    controls: (
      <ResultFilterControls questions={questions} filters={filters} onChange={setFilters} />
    ),
  }
}

/** Offers independent filters whose selections combine to narrow the saved answers. */
function ResultFilterControls({
  questions,
  filters,
  onChange,
}: {
  questions: QuizQuestion[]
  filters: ResultFilters
  onChange: (filters: ResultFilters) => void
}) {
  const sources = new Map(questions.map((question) => [resultSourceKey(question), question]))
  return (
    <div className="result-filters">
      <label>
        <span className="result-filter-label">Answer</span>
        <select
          value={filters.answer}
          onChange={(event) =>
            onChange({ ...filters, answer: event.target.value as ResultFilters['answer'] })
          }
        >
          <option value="all">All questions</option>
          <option value="correct">Correct</option>
          <option value="incorrect">Incorrect</option>
          <option value="skipped">Skipped</option>
          <option value="flagged">Flagged</option>
        </select>
      </label>
      <label>
        <span className="result-filter-label">Confidence</span>
        <select
          value={filters.confidence}
          onChange={(event) => onChange({ ...filters, confidence: event.target.value })}
        >
          <option value="all">All confidence levels</option>
          {['Confident', 'Educated Guess', 'Unsure', 'Not recorded'].map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
      </label>
      <label>
        <span className="result-filter-label">Source</span>
        <select
          value={filters.source}
          onChange={(event) => onChange({ ...filters, source: event.target.value })}
        >
          <option value="all">All sources</option>
          {[...sources].map(([key, question]) => (
            <option value={key} key={key}>
              {question.sourceName} ({question.sourceKind})
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        onClick={() => onChange({ answer: 'all', confidence: 'all', source: 'all' })}
      >
        Reset answer filters
      </button>
    </div>
  )
}
