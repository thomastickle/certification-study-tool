import { ApplicationError } from '../http/errors.ts'
import type { LibraryView } from './library-repository.ts'
import { privateItemId } from '../../shared/library-identity.ts'
import type { LibraryVisibility } from '../../shared/contracts.ts'

export class LibraryService {
  private repository: LibraryView
  private visibility: LibraryVisibility

  constructor(repository: LibraryView, visibility: LibraryVisibility = 'shared') {
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
      const legacy = this.visibility === 'shared' ? { sources, questions, source } : undefined
      this.repository.annotateDeletedBanks([{ ...source, sourceId: snapshotId }], legacy)
      if (this.visibility === 'shared') {
        this.repository.recordSourceDeletion(source)
      }
      if (!this.repository.deleteSource(id)) throw new ApplicationError('Source not found.', 404)
    })
  }
}
