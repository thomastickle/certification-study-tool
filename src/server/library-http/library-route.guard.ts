import { Injectable } from '@nestjs/common'
import type { CanActivate, ExecutionContext } from '@nestjs/common'

import { ApplicationError } from '../http/errors.ts'

import type { AdmittedRequest } from '../security/security-context.ts'

import { route } from './library-route.ts'

/** Validate raw normalized shape before write policy, scope acquisition or body consumption. */
@Injectable()
export class LibraryRouteGuard implements CanActivate {
  canActivate(execution: ExecutionContext): boolean {
    const request = execution.switchToHttp().getRequest<AdmittedRequest>()
    const path = route(request.admission.url.pathname)
    const patterns: Record<string, RegExp> = {
      GET: /^(sources|questions|concepts)$/,
      POST: /^(imports\/(preview|confirm)|concepts|concept-suggestions\/[a-f0-9]{64}\/dismiss)$/,
      PUT: /^concepts\/[a-f0-9-]{36}$/,
      DELETE: /^((questions|sources)\/\d+|concepts\/[a-f0-9-]{36})$/,
    }
    if (!patterns[request.method ?? '']?.test(path)) {
      throw new ApplicationError('Not found.', 404)
    }
    // A global LibraryWrite annotation would reject malformed shared paths too early.
    if (
      request.method !== 'GET' &&
      !request.admission.url.pathname.startsWith('/api/private/') &&
      request.admission.user?.role !== 'admin'
    ) {
      throw new ApplicationError('Only an administrator can change shared question banks.', 403)
    }
    return true
  }
}
