import { Injectable, SetMetadata, UseInterceptors, applyDecorators, Inject } from '@nestjs/common'
import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { jsonObjectBody } from '../http/json-object-body.ts'
import type { AdmittedRequest } from './security-context.ts'

const ALLOW_EMPTY_BODY = Symbol('AllowEmptyJsonBody')

/** Await the one body reader after guards and within the owned personal scope, before Nest inputs. */
@Injectable()
export class JsonBodyInterceptor implements NestInterceptor {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  async intercept(context: ExecutionContext, next: CallHandler) {
    const request = context.switchToHttp().getRequest<AdmittedRequest & { body: unknown }>()
    if (!request.studyContext || !request.inputWork) {
      throw new Error('ReadJsonBody requires @StudyRequest().')
    }
    const allowEmpty = this.reflector.get<boolean>(ALLOW_EMPTY_BODY, context.getHandler())
    request.body = await jsonObjectBody(request, allowEmpty, request.inputWork.signal)
    return next.handle()
  }
}

/** Use ordinary @Body() parameters after the guarded object-only parser has finished. */
export const ReadJsonBody = (allowEmpty = false) =>
  applyDecorators(SetMetadata(ALLOW_EMPTY_BODY, allowEmpty), UseInterceptors(JsonBodyInterceptor))
