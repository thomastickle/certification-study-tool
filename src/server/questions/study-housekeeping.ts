import { QuizService } from '../quizzes/quiz-service.ts'
import type { LibraryRepository } from './library-repository.ts'
import type { PrivateLibraries } from './private-libraries.ts'

/** Retry routine upkeep independently; one damaged owner file must not take other users offline. */
export function expireStudyWork(shared: LibraryRepository, libraries: PrivateLibraries): void {
  let accounts: string[]
  try {
    accounts = libraries.accounts()
  } catch {
    console.error('Could not discover private libraries for housekeeping; it will be retried.')
    return
  }
  for (const accountId of accounts) {
    try {
      const personal = libraries.open(accountId)
      try {
        const study = shared.forAccount(accountId, personal)
        study.synchronizeDeletions()
        new QuizService(study).expireDue()
      } finally {
        personal.close()
      }
    } catch {
      // Log only the canonical internal ID, never database errors, paths or private snapshots.
      console.error(`Private study upkeep failed for ${accountId}; it will be retried.`)
    }
  }
}
