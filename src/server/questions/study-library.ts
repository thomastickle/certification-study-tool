import type { LibraryView, QuestionRecord } from './library-repository.ts'
import type { Source } from '../../shared/contracts.ts'
import { privateItemId } from '../../shared/library-identity.ts'

export type StudyRepository = Pick<
  LibraryView,
  'quizStore' | 'certificationStore' | 'reviewedConcepts'
> & {
  sources(): Source[]
  allQuestions(): QuestionRecord[]
}

/** Combine authorized content for study without copying banks or accepting a browser-selected owner. */
export class StudyLibrary implements StudyRepository {
  private shared: LibraryView
  private personal: LibraryView
  private progress: LibraryView

  constructor(shared: LibraryView, personal: LibraryView, progress: LibraryView) {
    this.shared = shared
    this.personal = personal
    this.progress = progress
  }

  /** Database-local source IDs cannot collide in a combined practice selection or snapshot. */
  sources(): Source[] {
    return [
      ...this.shared.sources().map((source) => ({ ...source, visibility: 'shared' as const })),
      ...this.personal.sources().map((source) => ({
        ...source,
        id: privateItemId(source.id),
        visibility: 'private' as const,
      })),
    ]
  }

  /** Namespace both occurrence and source identity; content-based mastery remains unchanged. */
  allQuestions(): QuestionRecord[] {
    return [
      ...this.shared.allQuestions(),
      ...this.personal.allQuestions().map((question) => ({
        ...question,
        id: privateItemId(question.id),
        sourceId: privateItemId(question.sourceId),
      })),
    ]
  }

  /** Reviewed groups are read from both authorized libraries; writes stay with the owning library. */
  reviewedConcepts() {
    return [
      ...this.shared.reviewedConcepts(),
      ...this.personal.reviewedConcepts().map((group) => ({ ...group, id: `private:${group.id}` })),
    ]
  }

  /** Apply committed shared deletions only to this owner’s history, once per event sequence. */
  synchronizeDeletions(): void {
    const pending = this.shared.deletedSourcesAfter(this.personal.sharedDeletionCursor())
    if (!pending.length) {
      return
    }
    this.progress.quizStore().transaction(() => {
      const cursor = this.personal.sharedDeletionCursor()
      const events = pending.filter((event) => event.sequence > cursor)
      if (!events.length) {
        return
      }
      this.personal.annotateDeletedBanks(events)
      this.personal.saveSharedDeletionCursor(events.at(-1)!.sequence)
    })
  }

  quizStore() {
    return this.progress.quizStore()
  }

  certificationStore() {
    return this.progress.certificationStore()
  }
}
