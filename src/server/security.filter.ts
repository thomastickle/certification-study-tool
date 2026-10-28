import { Catch, Inject, NotFoundException } from '@nestjs/common'
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common'
import type { ServerResponse } from 'node:http'
import { ApplicationError } from './errors.ts'
import { WorkspaceChangedError } from './auth/application-authentication.ts'
import type { AdmittedRequest } from './security-context.ts'
import { SecurityGuard } from './security.guard.ts'

/** Emit the existing JSON contract and contain late failures without corrupting completed responses. */
@Catch()
export class SecurityExceptionFilter implements ExceptionFilter {
  constructor(@Inject(SecurityGuard) private readonly guard: SecurityGuard) {}

  catch(error: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp()
    const request = http.getRequest<AdmittedRequest>()
    if (error instanceof NotFoundException) {
      try {
        this.guard.authorize(request)
        error = new ApplicationError('Not found.', 404)
      } catch (denial) {
        error = denial
      }
    }
    try {
      securityFailure(error, request, http.getResponse<ServerResponse>())
    } finally {
      if (!request.securityWorkOwned) {
        request.finishSecurityWork?.()
      }
    }
  }
}

/** Shared with admission, which runs before Nest's route exception zone. */
export function securityFailure(
  error: unknown,
  request: AdmittedRequest,
  response: ServerResponse,
): void {
  if (response.destroyed || response.writableEnded) {
    return
  }
  if (response.headersSent) {
    response.destroy()
    return
  }
  const study = request.studyErrors === true
  const expected = error instanceof ApplicationError
  const status = expected ? error.status : 500
  let value: object
  if (error instanceof WorkspaceChangedError) {
    value = { code: 'workspace_changed', error: error.message }
  } else if (expected) {
    value = study
      ? { error: error.message.split('\n')[0], details: error.details }
      : { error: error.message }
  } else {
    value = {
      error: study
        ? 'The local operation failed. No partial import was saved.'
        : 'The request could not be completed. Please retry.',
    }
  }
  response.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  })
  response.end(JSON.stringify(value))
}
