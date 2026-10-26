import type { Source } from '../../shared/contracts.ts'
import type { StoredQuiz } from '../quizzes/quiz-repository.ts'
import { sameCertification } from '../quizzes/certification-scope.ts'

type Bank = Pick<Source, 'id' | 'name' | 'kind' | 'provider' | 'certification'>

type Occurrence = { sourceId: number; reference: string }

/** Pin legacy shared occurrences before deletion or migration can change the candidate banks. */
export function pinLegacySources(
  quiz: StoredQuiz,
  sources: Bank[],
  questions: Occurrence[],
  changedSource?: Bank,
): boolean {
  let changed = false
  for (const question of quiz.questions) {
    if (question.sourceId !== undefined) {
      continue
    }
    if (
      changedSource &&
      (question.sourceName !== changedSource.name ||
        question.sourceKind !== changedSource.kind ||
        !sameCertification(quiz.options, changedSource))
    ) {
      continue
    }
    const candidates = sources.filter(
      (source) =>
        source.name === question.sourceName &&
        source.kind === question.sourceKind &&
        sameCertification(source, quiz.options) &&
        (!quiz.options.sourceIds || quiz.options.sourceIds.includes(source.id)) &&
        questions.some(
          (record) => record.sourceId === source.id && record.reference === question.reference,
        ),
    )
    question.sourceId = candidates.length === 1 ? candidates[0]!.id : null
    changed = true
  }
  return changed
}
