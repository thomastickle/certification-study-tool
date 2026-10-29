import { Controller, Get } from '@nestjs/common'
import { PublicMethod } from '../security/security-context.ts'
import { HealthService } from './health.service.ts'

/** Public, method-specific liveness boundary for the staged Nest application. */
@Controller('api/health')
export class HealthController {
  private readonly healthService: HealthService

  constructor(healthService: HealthService) {
    this.healthService = healthService
  }

  /** Resolve liveness through Nest's injected service. */
  @Get()
  @PublicMethod('GET')
  health() {
    return this.healthService.health()
  }
}
