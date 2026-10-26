import { QuizService } from '../quizzes/quiz-service.ts'
import type { LibraryRepository } from './library-repository.ts'
import type { PrivateLibraries } from './private-libraries.ts'

/** Schedule maintenance without retaining private connections between ticks. */
export class StudyHousekeeping {
  private shared: LibraryRepository
  private libraries: PrivateLibraries
  private monotonicNow: () => number
  private now: () => number
  private nextReconciliation = -Infinity
  private deadlines = new Map<string, number>()

  constructor(
    shared: LibraryRepository,
    libraries: PrivateLibraries,
    monotonicNow = () => performance.now(),
    now = Date.now,
  ) {
    this.shared = shared
    this.libraries = libraries
    this.monotonicNow = monotonicNow
    this.now = now
  }

  /** Reconstruct after downtime, then reconcile unattended changes every five seconds. */
  tick(): void {
    const due = new Set(
      [...this.deadlines].filter(([, deadline]) => deadline <= this.now()).map(([id]) => id),
    )
    const elapsed = this.monotonicNow()
    if (elapsed >= this.nextReconciliation) {
      this.nextReconciliation = elapsed + 5000
      try {
        const accounts = this.libraries.accounts()
        const persisted = new Set(accounts)
        for (const id of this.deadlines.keys()) {
          if (!persisted.has(id)) {
            this.deadlines.delete(id)
            due.delete(id)
          }
        }
        for (const id of accounts) {
          due.add(id)
        }
      } catch {
        console.error('Could not discover private libraries for housekeeping; it will be retried.')
      }
    }
    for (const accountId of due) {
      try {
        const personal = this.libraries.open(accountId)
        try {
          const study = this.shared.forAccount(accountId, personal)
          study.synchronizeDeletions()
          new QuizService(study, this.now).expireDue()
          this.observe(accountId, personal)
        } finally {
          personal.close()
        }
      } catch {
        // Log only the canonical internal ID, never errors, paths or private snapshots.
        console.error(`Private study upkeep failed for ${accountId}; it will be retried.`)
      }
    }
  }

  /** Refresh after foreground work without owning, sharing or retaining the request connection. */
  observe(accountId: string, personal: LibraryRepository): void {
    try {
      const deadline = personal.quizStore().nextHousekeepingAt()
      if (deadline === null) {
        this.deadlines.delete(accountId)
      } else {
        this.deadlines.set(accountId, deadline)
      }
    } catch {
      // A metadata read must not turn a successful request into an error; retry on the next tick.
      this.deadlines.set(accountId, -Infinity)
      console.error(`Private study upkeep failed for ${accountId}; it will be retried.`)
    }
  }
}

/** Run a complete recovery pass; callers wanting recurring upkeep must retain the scheduler. */
export function expireStudyWork(shared: LibraryRepository, libraries: PrivateLibraries): void {
  new StudyHousekeeping(shared, libraries).tick()
}
