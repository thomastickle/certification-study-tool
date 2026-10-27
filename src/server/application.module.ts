import type { DynamicModule } from '@nestjs/common'
import { RuntimeModule } from './runtime.module.ts'
import type { RuntimeConfiguration } from './runtime-configuration.ts'
import { Module } from '@nestjs/common'
import { HealthController } from './health.controller.ts'
import { HealthService } from './health.service.ts'

/** Foundation only; production keeps the complete legacy entry point until atomic cutover. */
@Module({ controllers: [HealthController], providers: [HealthService] })
export class ApplicationModule {
  /** Share the same configured providers when feature controllers replace the legacy transport. */
  static register(configuration: RuntimeConfiguration): DynamicModule {
    return { module: ApplicationModule, imports: [RuntimeModule.register(configuration)] }
  }
}
