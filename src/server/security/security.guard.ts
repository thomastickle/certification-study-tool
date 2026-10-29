import { Inject, Injectable, RequestMethod } from '@nestjs/common'
import type { CanActivate, ExecutionContext } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { METHOD_METADATA } from '@nestjs/common/constants'
import { ApplicationAuthentication } from '../auth/application-authentication.ts'
import { SecurityRequestLifetime } from './security-lifetime.ts'
import { ApplicationError } from '../http/errors.ts'
import type { AdmittedRequest, LibraryVisibility } from './security-context.ts'
import { LIBRARY_WRITE, ORIGINAL_PATH, PUBLIC_METHOD } from './security-context.ts'

/** Own actor/workspace and content-write authorization before any body parameter is evaluated. */
@Injectable()
export class SecurityGuard implements CanActivate {
  constructor(
    @Inject(ApplicationAuthentication) private readonly authentication: ApplicationAuthentication,
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(SecurityRequestLifetime) private readonly lifetime: SecurityRequestLifetime,
  ) {}

  /** Admit only the declared method and verified actor before resolving any controller inputs. */
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AdmittedRequest>()
    request.finishSecurityWork = this.lifetime.begin()
    const handler = context.getHandler()
    const method = this.reflector.get<RequestMethod>(METHOD_METADATA, handler)
    const supported = method === RequestMethod.ALL || RequestMethod[method] === request.method
    const publicMethod = this.reflector.get<string>(PUBLIC_METHOD, handler)
    if (supported && publicMethod === request.method) {
      return true
    }
    this.authorize(request)
    if (!supported) {
      throw new ApplicationError('Not found.', 404)
    }
    const originalPath = this.reflector.get<RegExp>(ORIGINAL_PATH, handler)
    if (originalPath && !originalPath.test(request.admission.url.pathname)) {
      throw new ApplicationError('Not found.', 404)
    }
    const visibility = this.reflector.getAllAndOverride<LibraryVisibility>(LIBRARY_WRITE, [
      handler,
      context.getClass(),
    ])
    if (visibility === 'shared' && request.admission.user?.role !== 'admin') {
      throw new ApplicationError('Only an administrator can change shared question banks.', 403)
    }
    return true
  }

  /** Also used by the terminal not-found filter, after all feature routes have had a chance to match. */
  authorize(request: AdmittedRequest): void {
    if (request.admission.url.pathname.startsWith('/api/')) {
      this.authentication.requireWorkspace(request, request.admission.user)
      request.studyErrors = true
    }
  }
}
