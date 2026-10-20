import type { StoredQuiz } from '../quizzes/quiz-repository.ts'
import type { ReviewedConcept } from './concept-repository.ts'
import { completedQuestionIdentity } from '../quizzes/question-identity.ts'

export type VariationCandidate = { identity: string; tier: number; domain: number }

/** Read recency only from completed saved evidence; unfinished work cannot affect variation choice. */
export function completedRecency(attempts: StoredQuiz[]): Map<string, number> {
  const recency = new Map<string, number>()
  for (const attempt of attempts) {
    if (attempt.status !== 'completed' || !Number.isFinite(attempt.finishedAt)) {
      continue
    }
    attempt.questions.forEach((_question, index) => {
      const identity = completedQuestionIdentity(attempt, index)
      if (identity) {
        recency.set(identity, Math.max(recency.get(identity) ?? -Infinity, attempt.finishedAt!))
      }
    })
  }
  return recency
}

/** Keep the weighted draw unless a direct reviewed sibling is eligible in its domain and tier. */
export function preferVariation<T extends VariationCandidate>(
  drawn: T,
  eligible: T[],
  groups: ReviewedConcept[],
  recency: Map<string, number>,
  random = Math.random,
): T {
  const direct = new Set(
    groups
      .filter((group) => group.identities.includes(drawn.identity))
      .flatMap((group) => group.identities),
  )
  if (direct.size === 0) {
    return drawn
  }
  const alternatives = eligible.filter(
    (candidate) =>
      direct.has(candidate.identity) &&
      candidate.domain === drawn.domain &&
      candidate.tier === drawn.tier,
  )
  if (alternatives.length === 0) {
    return drawn
  }
  const leastRecent = Math.min(
    ...alternatives.map((candidate) => recency.get(candidate.identity) ?? -Infinity),
  )
  const tied = alternatives.filter(
    (candidate) => (recency.get(candidate.identity) ?? -Infinity) === leastRecent,
  )
  return tied[Math.floor(random() * tied.length)]!
}
