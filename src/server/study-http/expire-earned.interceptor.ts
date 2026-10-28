import { Injectable } from '@nestjs/common'
import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common'
import { QuizService } from '../quizzes/quiz-service.ts'
import type { AdmittedRequest } from '../security/security-context.ts'

/** Expire owned attempts inside the personal scope, before Nest resolves any earned-settings input. */
@Injectable()
export class ExpireEarnedInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    const request = context.switchToHttp().getRequest<AdmittedRequest>()
    new QuizService(request.studyContext!.study).expireDue()
    return next.handle()
  }
}
