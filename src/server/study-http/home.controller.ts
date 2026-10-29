import { Body } from '@nestjs/common'
import { ReadJsonBody } from '../security/json-body.interceptor.ts'
import { Controller, Get, Put, UseInterceptors } from '@nestjs/common'
import { StudyContext, StudyRequest } from '../security/security-context.ts'
import type { StudyRequestContext } from '../security/security-context.ts'
import { HomeService } from '../home/home-service.ts'
import { QuizService } from '../quizzes/quiz-service.ts'

import { ExpireEarnedInterceptor } from './expire-earned.interceptor.ts'

/** Expose actor-owned home state without retaining the request's storage. */
@Controller('api')
@StudyRequest()
export class HomeController {
  /** Expire active deadlines before calculating readiness. */
  @Get('home')
  home(@StudyContext() ctx: StudyRequestContext) {
    new QuizService(ctx.study).expireDue()
    return new HomeService(ctx.study).get()
  }

  /** Preserve expiry before body validation, as in the legacy handler. */
  @Put('certifications/earned')
  @ReadJsonBody()
  @UseInterceptors(ExpireEarnedInterceptor)
  earned(@StudyContext() ctx: StudyRequestContext, @Body() input: Record<string, unknown>) {
    return new HomeService(ctx.study).setEarned(input)
  }
}
