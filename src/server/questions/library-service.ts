import { ApplicationError } from '../errors.ts'
import { LibraryRepository } from './library-repository.ts'
import { pinLegacySources } from './bank-provenance.ts'
import { privateItemId } from '../../shared/library-identity.ts'
import type { LibraryVisibility } from '../../shared/contracts.ts'
import { sameCertification } from '../quizzes/certification-scope.ts'

export class LibraryService {
  private repository: LibraryRepository
  private visibility: LibraryVisibility

  constructor(repository: LibraryRepository, visibility: LibraryVisibility = 'shared') {
    this.repository = repository
    this.visibility = visibility
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
      const questions = this.repository.allQuestions()
      const snapshotId = this.visibility === 'private' ? privateItemId(id) : id
      this.repository.annotateSnapshots((quiz) => {
        if (!sameCertification(quiz.options, source)) {
          return false
        }
        const resolvedLegacy =
          this.visibility === 'shared' && pinLegacySources(quiz, sources, questions, source)
        const affected = quiz.questions.some((question) => question.sourceId === snapshotId)
        if (affected) {
          quiz.deletedBankNames = [...new Set([...(quiz.deletedBankNames ?? []), source.name])]
        }
        return affected || resolvedLegacy
      })
      if (this.visibility === 'shared') {
        this.repository.recordSourceDeletion(source)
      }
      if (!this.repository.deleteSource(id)) throw new ApplicationError('Source not found.', 404)
    })
  }
}
