import { chmodSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { ApplicationAuthentication } from '../auth/application-authentication.ts'
import { ImportPreviews } from '../importer/import-previews.ts'
import { LibraryRepository } from '../questions/library-repository.ts'
import { PrivateLibraries } from '../questions/private-libraries.ts'
import { StudyHousekeeping } from '../questions/study-housekeeping.ts'
import { StudyLibraryScope } from './study-library-scope.ts'
import type { RuntimeConfiguration } from './runtime-configuration.ts'

/** Own one initialized resource graph. Nest aliases borrow these objects; they never close roots. */
export class ApplicationRuntime {
  readonly authentication: ApplicationAuthentication
  readonly sharedLibrary: LibraryRepository
  readonly previews = new ImportPreviews()
  readonly privateLibraries: PrivateLibraries
  readonly housekeeping: StudyHousekeeping
  readonly studyLibraries: StudyLibraryScope
  private timer: NodeJS.Timeout | undefined
  private stopping: Promise<void> | undefined
  private draining: Promise<void> | undefined
  private closed = false
  private transport: (() => Promise<void>) | undefined

  private constructor(
    authentication: ApplicationAuthentication,
    sharedLibrary: LibraryRepository,
    privateLibraries: PrivateLibraries,
    schedule: RuntimeConfiguration['housekeepingSchedule'],
  ) {
    this.authentication = authentication
    this.sharedLibrary = sharedLibrary
    this.privateLibraries = privateLibraries
    this.housekeeping = new StudyHousekeeping(
      sharedLibrary,
      privateLibraries,
      schedule?.monotonicNow,
    )
    this.studyLibraries = new StudyLibraryScope(privateLibraries, this.housekeeping)
  }

  /** Migrate and recover before exposing providers; unwind every successfully acquired resource.
   * @throws Propagates configuration, filesystem, schema, ownership, migration and startup upkeep errors.
   */
  static async create(configuration: RuntimeConfiguration): Promise<ApplicationRuntime> {
    const authentication = new ApplicationAuthentication(configuration.authentication)
    let shared: LibraryRepository | undefined
    let runtime: ApplicationRuntime | undefined
    try {
      const subject = configuration.legacyOwnerSubject
      const legacyOwnerId = subject ? authentication.legacyOwnerId(subject) : undefined
      mkdirSync(dirname(configuration.databasePath), { recursive: true, mode: 0o700 })
      shared = new LibraryRepository(configuration.databasePath, 'local', { legacyOwnerId })
      chmodSync(configuration.databasePath, 0o600)
      const libraries = new PrivateLibraries(configuration.privateLibrariesDirectory)
      runtime = new ApplicationRuntime(
        authentication,
        shared,
        libraries,
        configuration.housekeepingSchedule,
      )
      libraries.migrateFrom(shared)
      await runtime.housekeeping.tick()
      if (configuration.housekeepingSchedule?.intervalMs !== 0) {
        runtime.timer = setInterval(() => {
          void runtime!.housekeeping.tick().catch(() => {
            console.error('Study upkeep failed; it will be retried.')
          })
        }, configuration.housekeepingSchedule?.intervalMs ?? 1000)
        runtime.timer.unref()
      }
      return runtime
    } catch (error) {
      try {
        await runtime?.onModuleDestroy()
      } finally {
        try {
          shared?.close()
        } finally {
          authentication.close()
        }
      }
      throw error
    }
  }

  /** Attach the selected transport drain before its fallible initialization/listen. */
  attachTransport(drain: () => Promise<void>): void {
    if (this.transport || this.stopping) {
      throw new Error('The runtime transport is already attached or stopping.')
    }
    this.transport = drain
  }

  /** Nest runs this before disposing its own transport: stop work, but keep roots usable by HTTP. */
  onModuleDestroy(): Promise<void> {
    if (!this.stopping) {
      clearInterval(this.timer)
      this.timer = undefined
      this.stopping = this.housekeeping.stop()
    }
    return this.stopping
  }

  /** Drain attached work before Nest HTTP disposal; account/shared roots remain usable until it settles. */
  beforeApplicationShutdown(): Promise<void> {
    this.draining ??= this.drainTransport()
    return this.draining
  }

  /** Keep draining transport even if stopping background work reports a failure. */
  private async drainTransport(): Promise<void> {
    try {
      await this.onModuleDestroy()
    } finally {
      await this.transport?.()
    }
  }

  /** Nest calls this after transport disposal, when no handler can still use shared/account roots. */
  onApplicationShutdown(): void {
    if (this.closed) {
      return
    }
    this.closed = true
    try {
      this.sharedLibrary.close()
    } finally {
      this.authentication.close()
    }
  }
}
