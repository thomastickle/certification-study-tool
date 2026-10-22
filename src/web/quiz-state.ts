import type { QuizQuestion, QuizView } from '../shared/quiz-contracts.ts'

export function warningThreshold(remainingMs: number): '10-minute' | '2-minute' | null {
  if (remainingMs <= 2 * 60_000) return '2-minute'
  if (remainingMs <= 10 * 60_000) return '10-minute'
  return null
}

export function reviewQuestionIds(questions: QuizQuestion[]): number[] {
  return questions.filter((question) => question.flagged).map((question) => question.questionId)
}

/** Color review tiles by completion only; confidence and flags remain separate indicators. */
export function reviewAnswerState(question: QuizQuestion): 'unanswered' | 'partial' | 'answered' {
  if (question.selected.length === 0) {
    return 'unanswered'
  }
  if (question.selected.length < question.selectCount) {
    return 'partial'
  }
  return 'answered'
}

export function meetsPracticeTarget(percent: number): boolean {
  return percent >= 80
}

/** Poll responses update status/clock; answer saves own the active answer state. */
export function mergeQuizPoll(current: QuizView, incoming: QuizView): QuizView {
  if (current.id !== incoming.id) return current
  if (incoming.status !== 'active') return incoming
  if (current.status !== 'active' || incoming.serverNow <= current.serverNow) return current
  return { ...current, serverNow: incoming.serverNow }
}

/** Keep the clock's units unambiguous for both quizzes and longer exams. */
export function formatTime(seconds: number): string {
  return [Math.floor(seconds / 3600), Math.floor((seconds % 3600) / 60), seconds % 60]
    .map((value) => value.toString().padStart(2, '0'))
    .join(':')
}
