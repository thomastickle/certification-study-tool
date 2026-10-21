import type { StoredQuiz } from '../src/server/quizzes/quiz-repository.ts'

export const homeNow = Date.parse('2026-10-20T16:00:00Z')

/** Synthetic full exams have the real quotas and independently identifiable question pools. */
export function homeExam(id: string, daysAgo: number, correctCount = 65, pool = id): StoredQuiz {
  const finishedAt = homeNow - daysAgo * 86400000
  const questions = [16, 19, 22, 8]
    .flatMap((count, domain) =>
      Array.from({ length: count }, (_, index) => ({
        questionId: 0,
        question: `Synthetic readiness ${pool} domain ${domain + 1} question ${index}`,
        type: 'single_select' as const,
        selectCount: 1,
        answers: [
          { id: 0, text: 'Correct example' },
          { id: 1, text: 'Wrong example' },
        ],
        selected: [0],
        correctAnswerIds: [0],
        correct: true,
        confidence: 'Confident' as const,
        flagged: false,
        domain: domain + 1,
        area: null,
        topic: null,
        sourceName: 'Synthetic readiness fixtures',
        sourceKind: 'third_party',
        reference: `${pool}-${domain}-${index}`,
      })),
    )
    .map((question, index) => ({
      ...question,
      questionId: index,
      selected: index < correctCount ? [0] : [1],
      correct: index < correctCount,
    }))
  return {
    id,
    mode: 'exam',
    status: 'completed',
    startedAt: finishedAt - 60 * 60_000,
    deadline: finishedAt + 30 * 60_000,
    finishedAt,
    serverNow: finishedAt,
    correctCount,
    total: questions.length,
    pauseHistory: { complete: true, intervals: [] },
    options: { mode: 'exam', sourceFilter: 'mixed', questionType: 'mixed' },
    questions,
    keys: questions.map(() => ({ fingerprint: 'synthetic-private-hash', correct: [0] })),
  }
}
