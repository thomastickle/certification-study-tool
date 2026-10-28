import { Controller, Get } from '@nestjs/common'
import { StudyContext, StudyRequest } from '../security/security-context.ts'
import type { StudyRequestContext } from '../security/security-context.ts'

import { QuizService } from '../quizzes/quiz-service.ts'

import { ReportService } from '../reports/report-service.ts'

import { scope } from './quiz-context.ts'

/** Expose the actor-owned reports resource within the existing personal scope. */
@Controller('api')
@StudyRequest()
export class ReportsController {
  /** Expire attempts before reading completed snapshot aggregates. */
  @Get('reports')
  reports(@StudyContext() ctx: StudyRequestContext) {
    new QuizService(ctx.study).expireDue()
    return new ReportService(ctx.study).get({
      mode: ctx.query.get('mode'),
      days: ctx.query.get('days'),
      ...scope(ctx),
    })
  }
}
