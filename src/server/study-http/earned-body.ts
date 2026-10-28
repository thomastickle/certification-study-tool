import { createParamDecorator } from '@nestjs/common'
import type { AdmittedRequest } from '../security/security-context.ts'
import { QuizService } from '../quizzes/quiz-service.ts'
import { jsonObjectBody } from '../http/json-object-body.ts'

/** Keep earned-settings expiry ahead of body parsing, including invalid bodies. */
export const EarnedBody = createParamDecorator((_data, context) => {
  const request = context.switchToHttp().getRequest<AdmittedRequest>()
  const ctx = request.studyContext!
  new QuizService(ctx.study).expireDue()
  return jsonObjectBody(request, false, request.inputWork!.signal)
})
