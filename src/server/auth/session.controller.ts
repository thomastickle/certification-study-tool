import { Controller, Get, Req } from '@nestjs/common'

import { PublicMethod } from '../security/security-context.ts'
import type { AdmittedRequest } from '../security/security-context.ts'

/** Purposeful session endpoint; no client account selector participates in identity lookup. */
@Controller('api/session')
export class SessionController {
  /** Report a verified session without requiring a workspace header. */
  @Get()
  @PublicMethod('GET')
  session(@Req() request: AdmittedRequest) {
    return { user: request.admission.user ?? null }
  }
}
