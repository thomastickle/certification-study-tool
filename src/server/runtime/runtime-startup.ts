import { ApplicationRuntime } from './application-runtime.ts'
import type { RuntimeConfiguration } from './runtime-configuration.ts'

/** Retain fallible Nest provider acquisition until an application exists to own shutdown hooks. */
export class RuntimeStartup {
  private acquiring: Promise<ApplicationRuntime> | undefined
  private failed = false

  /** Deduplicate acquisition within this explicitly configured module graph. */
  acquire(configuration: RuntimeConfiguration): Promise<ApplicationRuntime> {
    if (this.failed) {
      return Promise.reject(new Error('Runtime startup has already failed.'))
    }
    this.acquiring ??= ApplicationRuntime.create(configuration)
    return this.acquiring
  }

  /** Release even when another feature provider rejects before NestFactory returns an app. */
  async closeFailedStartup(): Promise<void> {
    this.failed = true
    const runtime = await this.acquiring?.catch(() => undefined)
    if (!runtime) {
      return
    }
    try {
      await runtime.onModuleDestroy()
    } finally {
      try {
        await runtime.beforeApplicationShutdown()
      } finally {
        runtime.onApplicationShutdown()
      }
    }
  }
}
