import { Injectable } from '@nestjs/common'

import type { AdmittedRequest } from '../security/security-context.ts'

import type { CanActivate, ExecutionContext } from '@nestjs/common'
import { ApplicationError } from '../http/errors.ts'

/** Match the admitted, still-encoded pathname before any body work. */
@Injectable()
export class QuizPathGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AdmittedRequest>()
    if (
      !/^\/api\/quizzes\/[a-f0-9-]{36}(?:\/(answers|submit|abandon|pause|resume|restore))?$/.test(
        request.admission.url.pathname,
      )
    ) {
      throw new ApplicationError('Not found.', 404)
    }
    return true
  }
}
