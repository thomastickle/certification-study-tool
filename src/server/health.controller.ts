import { Controller, Get } from '@nestjs/common'
import { HealthService } from './health.service.ts'

/** Minimal reusable HTTP boundary for the staged Nest application. */
@Controller('api/health')
export class HealthController {
  private readonly healthService: HealthService

  constructor(healthService: HealthService) {
    this.healthService = healthService
  }

  /** Resolve liveness through Nest's injected service. */
  @Get()
  health() {
    return this.healthService.health()
  }
}
