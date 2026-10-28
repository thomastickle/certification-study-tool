import { Inject, Injectable } from '@nestjs/common'
import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { from, lastValueFrom } from 'rxjs'
import { StudyLibraryScope } from '../runtime/study-library-scope.ts'
import { SHARED_LIBRARY_REPOSITORY } from '../runtime/runtime.module.ts'
import { LibraryRepository } from '../questions/library-repository.ts'
import type { AdmittedRequest } from './security-context.ts'
import { StudyInputWork } from './study-input-work.ts'
import { STUDY_INPUTS_REGISTERED } from './study-input-registration.ts'
import type { ServerResponse } from 'node:http'
import { JOINED_STUDY_INPUTS, STUDY_REQUEST } from './security-context.ts'

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

    const execute = () => Promise.resolve().then(() => lastValueFrom(next.handle()))

    if (!scoped) {
      request.securityWorkOwned = true
      return from(execute().finally(request.finishSecurityWork))
    }
    const actor = request.admission.user
    if (!actor) {
      throw new Error('StudyRequest requires an authenticated actor.')
    }
    const joined = this.reflector.getAllAndOverride<boolean>(JOINED_STUDY_INPUTS, [
      context.getHandler(),
      context.getClass(),
    ])
    if (joined && !this.reflector.get<boolean>(STUDY_INPUTS_REGISTERED, context.getHandler())) {
      throw new Error('StudyRequest input metadata must be registered by createApplication.')
    }
    request.securityWorkOwned = true

    const operation = this.scope.withLibrary(actor, request.method, async (personal) => {
      const inputs = new StudyInputWork()
      request.inputWork = inputs
      const response = context.switchToHttp().getResponse<ServerResponse>()

      const disconnect = () => inputs.cancel(new Error('The request was interrupted.'))

      const responseClosed = () => {
        if (!response.writableFinished) {
          disconnect()
        }
      }

      request.once('aborted', disconnect)
      response.once('close', responseClosed)
      try {
        // A later guard may have awaited past the client's close event before scope entry.
        if (
          request.aborted ||
          response.destroyed ||
          response.writableEnded ||
          request.socket.destroyed
        ) {
          disconnect()
        }
        const study = this.shared.forAccount(actor.id, personal)
        study.synchronizeDeletions()
        request.studyContext = {
          inputSignal: inputs.signal,
          actor,
          url: request.admission.url,
          query: new URLSearchParams(request.admission.url.search),
          personal,
          shared: this.shared,
          study,
          content: (visibility) =>
            (visibility === 'private' ? personal : this.shared).forAccount(actor.id),
        }
        return await execute()
      } catch (error) {
        inputs.cancel(error)
        throw error
      } finally {
        try {
          await inputs.settle()
        } finally {
          request.off('aborted', disconnect)
          response.off('close', responseClosed)
        }
      }
    })

    return from(operation.finally(request.finishSecurityWork))
  }
}
