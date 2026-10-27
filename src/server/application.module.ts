import { Module } from '@nestjs/common'
import { HealthController } from './health.controller.ts'
import { HealthService } from './health.service.ts'

/** Foundation only; production keeps the complete legacy entry point until atomic cutover. */
@Module({ controllers: [HealthController], providers: [HealthService] })
export class ApplicationModule {}
