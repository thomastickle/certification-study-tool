import type { StoredQuiz } from './quiz-repository.ts'
import { completedQuestionIdentity } from './question-identity.ts'
import { replayMastery } from './mastery.ts'
import type { MasteryEvidence } from './mastery.ts'

/** Missing or contradictory legacy scoring/confidence/time evidence stays unknown. */
export function completedEvidence(quiz: StoredQuiz, index: number): MasteryEvidence | null {
  const identity = completedQuestionIdentity(quiz, index)
  const q = quiz.questions[index]
  if (
    !identity ||
    !q ||
    !Number.isFinite(quiz.finishedAt) ||
    !Number.isFinite(new Date(quiz.finishedAt!).getTime()) ||
    !Number.isFinite(quiz.startedAt) ||
    quiz.finishedAt! < quiz.startedAt ||
    !Array.isArray(q.selected) ||
    q.selected.length > q.selectCount ||
    new Set(q.selected).size !== q.selected.length ||
    q.selected.some((id) => !q.answers.some((a) => a.id === id)) ||
    (q.confidence !== null && !['Confident', 'Educated Guess', 'Unsure'].includes(q.confidence))
  ) {
    return null
  }
  const key = q.correctAnswerIds ?? quiz.keys[index]!.correct
  const correct = q.selected.length === key.length && q.selected.every((id) => key.includes(id))
  if (typeof q.correct !== 'boolean' || q.correct !== correct) {
    return null
  }
  return {
    identity,
    attemptId: quiz.id,
    at: quiz.finishedAt!,
    answered: q.selected.length > 0,
    correct,
    confidence: q.confidence,
  }
}

/** Completed evidence is the sole source of the scheduler's lifetime state. */
export function masteryHistory(completed: StoredQuiz[]) {
  const events = completed.flatMap((quiz) =>
    quiz.questions.flatMap((_, index) => {
      const event = completedEvidence(quiz, index)
      if (event) {
        return [event]
      }
      // An incomplete earlier encounter cannot make a later success first-ever.
      const identity = completedQuestionIdentity(quiz, index)
      if (!identity) {
        return []
      }
      return [
        {
          identity,
          attemptId: quiz.id,
          at: Number.isFinite(quiz.finishedAt) ? quiz.finishedAt! : -Infinity,
          answered: false,
          correct: false,
          confidence: null,
          unknown: true,
        },
      ]
    }),
  )
  return { states: replayMastery(events) }
}
