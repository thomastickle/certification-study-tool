import { Injectable } from '@nestjs/common'

/** Public liveness response; the runtime provider establishes resource readiness before listening. */
@Injectable()
export class HealthService {
  /** Report process liveness without opening a database or contacting the identity provider. */
  health() {
    return { status: 'ok' }
  }
}
