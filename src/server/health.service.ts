import { Injectable } from '@nestjs/common'

/** Public liveness response; resource readiness belongs to the later lifecycle stage. */
@Injectable()
export class HealthService {
  /** Report process liveness without opening a database or contacting the identity provider. */
  health() {
    return { status: 'ok' }
  }
}
