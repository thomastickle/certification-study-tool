import { ApplicationError } from '../errors.ts'
import { LibraryRepository } from './library-repository.ts'
import { sameCertification } from '../quizzes/certification-scope.ts'

export class LibraryService {
  private repository: LibraryRepository

  constructor(repository: LibraryRepository) {
    this.repository = repository
  }

  deleteQuestion(id: number): void {
    this.repository.transaction(() => {
      if (!this.repository.deleteQuestion(id))
        throw new ApplicationError('Question not found.', 404)
    })
  }

  /**
   * Atomically retain drawn-bank deletion provenance with the saved attempts.
   * @throws {ApplicationError} When the source no longer exists.
   */
  deleteSource(id: number): void {
    this.repository.transaction(() => {
      const sources = this.repository.sources()
      const source = sources.find((source) => source.id === id)
      if (!source) {
        throw new ApplicationError('Source not found.', 404)
      }
      const scope = { provider: source.provider, certification: source.certification }
      const candidates = new Set(
        sources
          .filter(
            (candidate) =>
              candidate.name === source.name &&
              candidate.kind === source.kind &&
              sameCertification(candidate, scope),
          )
          .map((candidate) => candidate.id),
      )
      const references = new Map<string, Set<number>>()
      for (const question of this.repository.allQuestions()) {
        if (candidates.has(question.sourceId)) {
          const ids = references.get(question.reference) ?? new Set<number>()
          ids.add(question.sourceId)
          references.set(question.reference, ids)
        }
      }
      this.repository.annotateSnapshots((quiz) => {
        if (!sameCertification(quiz.options, scope)) {
          return false
        }
        let resolvedLegacy = false
        for (const question of quiz.questions) {
          if (
            question.sourceId !== undefined ||
            question.sourceName !== source.name ||
            question.sourceKind !== source.kind
          ) {
            continue
          }
          const ids = [...(references.get(question.reference) ?? [])].filter(
            (candidateId) =>
              !quiz.options.sourceIds || quiz.options.sourceIds.includes(candidateId),
          )
          // Pin ambiguity before deletion so a later deletion cannot turn it into a false match.
          question.sourceId = ids.length === 1 ? ids[0]! : null
          resolvedLegacy = true
        }
        const affected = quiz.questions.some((question) => question.sourceId === id)
        if (affected) {
          quiz.deletedBankNames = [...new Set([...(quiz.deletedBankNames ?? []), source.name])]
        }
        return affected || resolvedLegacy
      })
      if (!this.repository.deleteSource(id)) throw new ApplicationError('Source not found.', 404)
    })
  }
}
