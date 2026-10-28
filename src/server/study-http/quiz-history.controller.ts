import { Controller, Get, Delete, UseGuards, Header } from '@nestjs/common'
import { StudyContext, StudyRequest } from '../security/security-context.ts'
import type { StudyRequestContext } from '../security/security-context.ts'

import { QuizService } from '../quizzes/quiz-service.ts'

import { ApplicationError } from '../http/errors.ts'

import { QuizPathGuard } from './quiz-path.guard.ts'

import { quizId, scope } from './quiz-context.ts'

/** Expose the actor-owned quiz-history resource within the existing personal scope. */
@Controller('api')
@StudyRequest()
export class QuizHistoryController {
  /** Read actor-owned recent attempts. */
  @Get('quizzes')
  recent(@StudyContext() ctx: StudyRequestContext) {
    return new QuizService(ctx.study).recent(scope(ctx))
  }

  /** Read the actor's recoverable result summaries. */
  @Get('quizzes/deleted')
  deleted(@StudyContext() ctx: StudyRequestContext) {
    return new QuizService(ctx.study).deletedResults(scope(ctx))
  }

  /** Accept only the first exact boolean option; irrelevant bodies remain unread. */
  @Delete('quizzes/:id')
  @Header('Content-Type', 'application/json')
  @UseGuards(QuizPathGuard)
  remove(@StudyContext() ctx: StudyRequestContext) {
    const permanent = ctx.query.get('permanent')
    if (permanent !== null && permanent !== 'true' && permanent !== 'false') {
      throw new ApplicationError('Choose a valid permanent deletion option.')
    }
    return new QuizService(ctx.study).deleteResult(quizId(ctx), permanent === 'true') ?? 'null'
  }
}
