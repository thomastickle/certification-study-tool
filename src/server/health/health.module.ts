import { Module } from '@nestjs/common'
import { HealthController } from './health.controller.ts'
import { HealthService } from './health.service.ts'

/** Register the public liveness endpoint and its provider together. */
@Module({ controllers: [HealthController], providers: [HealthService] })
export class HealthModule {}
