import type { QuizQuestion } from '../../../shared/quiz-contracts.ts'

export type ResultFilters = {
  answer: 'all' | 'correct' | 'incorrect' | 'skipped' | 'flagged'
  confidence: string
  source: string
}

/** Filters saved answer evidence without changing the attempt's score. */
export function filterResultQuestions(questions: QuizQuestion[], filters: ResultFilters) {
  return questions.filter((question) => {
    if (
      filters.confidence !== 'all' &&
      (question.confidence ?? 'Not recorded') !== filters.confidence
    ) {
      return false
    }
    if (filters.source !== 'all' && resultSourceKey(question) !== filters.source) {
      return false
    }
    switch (filters.answer) {
      case 'correct':
        return question.correct === true
      case 'incorrect':
        return question.selected.length > 0 && question.correct === false
      case 'skipped':
        return question.selected.length === 0
      case 'flagged':
        return question.flagged
      default:
        return true
    }
  })
}

/** Preserves bank identity while allowing legacy results to filter by saved provenance. */
export function resultSourceKey(question: QuizQuestion): string {
  if (question.sourceId != null) {
    return `id:${question.sourceId}`
  }
  return JSON.stringify([question.sourceKind, question.sourceName])
}
