import { Controller, Get, Put, Post, Delete, HttpCode, UseGuards, Header } from '@nestjs/common'
import { StudyContext, StudyRequest, JsonObjectBody } from '../security/security-context.ts'
import type { StudyRequestContext } from '../security/security-context.ts'

import { QuizService } from '../quizzes/quiz-service.ts'

import { ApplicationError } from '../http/errors.ts'
import { ReportService } from '../reports/report-service.ts'
import { parseLibraryItemId } from '../../shared/library-identity.ts'

import { QuizPathGuard } from './quiz-path.guard.ts'

/** Extract only after the route guard has verified the original normalized shape. */
function quizId(ctx: StudyRequestContext): string {
  return ctx.url.pathname.split('/')[3]!
}

/** Preserve first-value query semantics for certification-scoped reads. */
function scope(ctx: StudyRequestContext) {
  return {
    provider: ctx.query.get('provider') ?? undefined,
    certification: ctx.query.get('certification') ?? undefined,
  }
}

/** Translate focused study routes directly to the existing actor-bound services. */
@Controller('api')
@StudyRequest()
export class StudyController {
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

  /** Read actor-owned recent attempts. */
  @Get('quizzes')
  recent(@StudyContext() ctx: StudyRequestContext) {
    return new QuizService(ctx.study).recent(scope(ctx))
  }

  /** Validate the first mode value using the legacy accepted modes. */
  @Get('quizzes/current')
  @Header('Content-Type', 'application/json')
  current(@StudyContext() ctx: StudyRequestContext) {
    const mode = ctx.query.get('mode') ?? 'quiz'
    if (mode !== 'quiz' && mode !== 'exam' && mode !== 'review') {
      throw new ApplicationError('Choose a valid practice mode.')
    }
    return new QuizService(ctx.study).current(mode, scope(ctx)) ?? 'null'
  }

  /** Parse qualified source identities with the existing library parser. */
  @Get('quizzes/due')
  due(@StudyContext() ctx: StudyRequestContext) {
    const ids = ctx.query.get('sourceIds')
    return new QuizService(ctx.study).due({
      ...scope(ctx),
      sourceFilter: ctx.query.get('sourceFilter') ?? 'mixed',
      questionType: ctx.query.get('questionType') ?? 'mixed',
      ...(ids === null ? {} : { sourceIds: ids.split(',').map(parseLibraryItemId) }),
    })
  }

  /** Read the actor's recoverable result summaries. */
  @Get('quizzes/deleted')
  deleted(@StudyContext() ctx: StudyRequestContext) {
    return new QuizService(ctx.study).deletedResults(scope(ctx))
  }

  /** Start a snapshot through domain validation. */
  @Post('quizzes')
  @HttpCode(201)
  start(
    @StudyContext() ctx: StudyRequestContext,
    @JsonObjectBody() input: Record<string, unknown>,
  ) {
    return new QuizService(ctx.study).start(input)
  }

  /** Delegate get to the actor's quiz service after raw path validation. */
  @Get('quizzes/:id')
  @HttpCode(200)
  @UseGuards(QuizPathGuard)
  get(@StudyContext() ctx: StudyRequestContext) {
    return new QuizService(ctx.study).get(quizId(ctx))
  }

  /** Delegate save to the actor's quiz service after raw path validation. */
  @Put('quizzes/:id/answers')
  @HttpCode(200)
  @UseGuards(QuizPathGuard)
  save(@StudyContext() ctx: StudyRequestContext, @JsonObjectBody() input: Record<string, unknown>) {
    return new QuizService(ctx.study).save(quizId(ctx), input)
  }

  /** Delegate submit to the actor's quiz service after raw path validation. */
  @Post('quizzes/:id/submit')
  @HttpCode(200)
  @UseGuards(QuizPathGuard)
  submit(
    @StudyContext() ctx: StudyRequestContext,
    @JsonObjectBody() input: Record<string, unknown>,
  ) {
    return new QuizService(ctx.study).submit(quizId(ctx), input)
  }

  /** Delegate pause to the actor's quiz service after raw path validation. */
  @Post('quizzes/:id/pause')
  @HttpCode(200)
  @UseGuards(QuizPathGuard)
  pause(
    @StudyContext() ctx: StudyRequestContext,
    @JsonObjectBody(true) input: Record<string, unknown>,
  ) {
    return new QuizService(ctx.study).pause(quizId(ctx), input)
  }

  /** Delegate resume to the actor's quiz service after raw path validation. */
  @Post('quizzes/:id/resume')
  @HttpCode(200)
  @UseGuards(QuizPathGuard)
  resume(@StudyContext() ctx: StudyRequestContext) {
    return new QuizService(ctx.study).resume(quizId(ctx))
  }

  /** Delegate abandon to the actor's quiz service after raw path validation. */
  @Post('quizzes/:id/abandon')
  @Header('Content-Type', 'application/json')
  @HttpCode(200)
  @UseGuards(QuizPathGuard)
  abandon(@StudyContext() ctx: StudyRequestContext) {
    return new QuizService(ctx.study).abandon(quizId(ctx)) ?? 'null'
  }

  /** Delegate restore to the actor's quiz service after raw path validation. */
  @Post('quizzes/:id/restore')
  @HttpCode(200)
  @UseGuards(QuizPathGuard)
  restore(@StudyContext() ctx: StudyRequestContext) {
    return new QuizService(ctx.study).restoreResult(quizId(ctx))
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
