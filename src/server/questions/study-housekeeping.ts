import { setImmediate as yieldTurn } from 'node:timers/promises'
import { QuizService } from '../quizzes/quiz-service.ts'
import type { LibraryRepository } from './library-repository.ts'
import type { PrivateLibraries } from './private-libraries.ts'

/** Schedule maintenance without retaining private connections between owner-sized slices. */
export class StudyHousekeeping {
  private shared: LibraryRepository
  private libraries: PrivateLibraries
  private monotonicNow: () => number
  private now: () => number
  private nextReconciliation = -Infinity
  private deadlines = new Map<string, number>()
  private attempted = new Set<string>()
  private running: Promise<void> | undefined
  private requested = false
  private stopped = false

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

  /** Coalesce overlapping ticks; startup awaits this same promise before accepting HTTP. */
  tick(): Promise<void> {
    if (this.stopped) {
      return Promise.resolve()
    }
    this.requested = true
    if (!this.running) {
      this.running = this.run().finally(() => {
        this.running = undefined
      })
    }
    return this.running
  }

  /** Cancel unstarted owners and drain the current pass before closing the shared repository. */
  async stop(): Promise<void> {
    this.stopped = true
    await this.running
  }

  /** Reads can expire existing work but cannot create an earlier deadline; observe attempted writes. */
  observeRequest(method: string | undefined, accountId: string, personal: LibraryRepository): void {
    if (method !== 'GET' && method !== 'HEAD') {
      this.observe(accountId, personal)
    }
  }

  /** Refresh after foreground work without owning, sharing or retaining the request connection. */
  observe(accountId: string, personal: LibraryRepository): void {
    if (this.stopped) {
      return
    }
    // A mutation between slices can create earlier work even for an already visited owner.
    this.attempted.delete(accountId)
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

  /** Give due owners priority between every closed-connection reconciliation slice. */
  private async run(): Promise<void> {
    do {
      this.requested = false
      this.attempted.clear()
      const sweep = this.discover()
      while (!this.stopped) {
        const accountId = this.nextDue() ?? sweep.values().next().value
        if (accountId === undefined) {
          break
        }
        sweep.delete(accountId)
        const attemptedAt = this.now()
        this.maintain(accountId)
        const deadline = this.deadlines.get(accountId)
        // Suppress failed or still-due work, but let a future deadline interrupt this sweep later.
        if (deadline !== undefined && deadline <= attemptedAt) {
          this.attempted.add(accountId)
        }
        // One owner's synchronous SQLite work is indivisible; never carry its connection over a yield.
        await yieldTurn()
      }
    } while (this.requested && !this.stopped)
  }

  /** Select due work afresh so deadlines observed or reached during a sweep can take priority. */
  private nextDue(): string | undefined {
    const now = this.now()
    for (const [id, deadline] of this.deadlines) {
      if (deadline <= now && !this.attempted.has(id)) {
        return id
      }
    }
    return undefined
  }

  /** Reconstruct after downtime and retry unattended changes on a monotonic five-second cadence. */
  private discover(): Set<string> {
    const elapsed = this.monotonicNow()
    if (elapsed < this.nextReconciliation) {
      return new Set()
    }
    this.nextReconciliation = elapsed + 5000
    try {
      const persisted = new Set(this.libraries.accounts())
      for (const id of this.deadlines.keys()) {
        if (!persisted.has(id)) {
          this.deadlines.delete(id)
        }
      }
      return persisted
    } catch {
      console.error('Could not discover private libraries for housekeeping; it will be retried.')
      return new Set()
    }
  }

  /** Isolate failures, close each returned connection, and retry failed work on a later tick. */
  private maintain(accountId: string): void {
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
      this.deadlines.set(accountId, -Infinity)
      // Log only the canonical internal ID, never errors, paths or private snapshots.
      console.error(`Private study upkeep failed for ${accountId}; it will be retried.`)
    }
  }
}
