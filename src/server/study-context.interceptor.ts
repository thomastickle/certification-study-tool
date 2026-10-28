import { Inject, Injectable } from '@nestjs/common'
import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { from, lastValueFrom } from 'rxjs'
import { StudyLibraryScope } from './study-library-scope.ts'
import { SHARED_LIBRARY_REPOSITORY } from './runtime.module.ts'
import { LibraryRepository } from './questions/library-repository.ts'
import type { AdmittedRequest } from './security-context.ts'
import { STUDY_REQUEST } from './security-context.ts'

/** Retain personal storage through body parameters and the full asynchronous controller operation. */
@Injectable()
export class StudyContextInterceptor implements NestInterceptor {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(StudyLibraryScope) private readonly scope: StudyLibraryScope,
    @Inject(SHARED_LIBRARY_REPOSITORY) private readonly shared: LibraryRepository,
  ) {}

  /** Release ownership only after guards, parameters, handler work and personal cleanup settle. */
  intercept(context: ExecutionContext, next: CallHandler) {
    const request = context.switchToHttp().getRequest<AdmittedRequest>()
    const scoped = this.reflector.getAllAndOverride<boolean>(STUDY_REQUEST, [
      context.getHandler(),
      context.getClass(),
    ])

    const execute = () => lastValueFrom(next.handle())

    if (!scoped) {
      return from(execute().finally(request.finishSecurityWork))
    }
    const actor = request.admission.user
    if (!actor) {
      throw new Error('StudyRequest requires an authenticated actor.')
    }
    const operation = this.scope.withLibrary(actor, request.method, async (personal) => {
      const study = this.shared.forAccount(actor.id, personal)
      study.synchronizeDeletions()
      request.studyContext = {
        actor,
        url: request.admission.url,
        query: new URLSearchParams(request.admission.url.search),
        personal,
        shared: this.shared,
        study,
        content: (visibility) =>
          (visibility === 'private' ? personal : this.shared).forAccount(actor.id),
      }
      return execute()
    })
    return from(operation.finally(request.finishSecurityWork))
  }
}
