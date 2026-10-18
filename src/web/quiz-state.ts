import type { QuizQuestion } from '../shared/quiz-contracts.ts';

export function warningThreshold(remainingMs: number): '10-minute' | '2-minute' | null {
  if (remainingMs <= 2 * 60_000) return '2-minute';
  if (remainingMs <= 10 * 60_000) return '10-minute';
  return null;
}

export function reviewQuestionIds(questions: QuizQuestion[]): number[] {
  return questions.filter(question => question.selected.length === 0 || question.flagged || question.confidence === null || question.confidence !== 'Confident').map(question => question.questionId);
}

export function meetsPracticeTarget(percent: number): boolean {
  return percent >= 80;
}
