import { Body } from '@nestjs/common'
import { ReadJsonBody } from '../security/json-body.interceptor.ts'
import { Controller, Get, Put, Post, HttpCode, UseGuards, Header } from '@nestjs/common'
import { StudyContext, StudyRequest } from '../security/security-context.ts'
import type { StudyRequestContext } from '../security/security-context.ts'

import { QuizService } from '../quizzes/quiz-service.ts'

import { ApplicationError } from '../http/errors.ts'

import { parseLibraryItemId } from '../../shared/library-identity.ts'

import { QuizPathGuard } from './quiz-path.guard.ts'

import { quizId, scope } from './quiz-context.ts'

/** Expose the actor-owned quiz resource within the existing personal scope. */
@Controller('api')
@StudyRequest()
export class QuizController {
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

  /** Start a snapshot through domain validation. */
  @Post('quizzes')
  @ReadJsonBody()
  @HttpCode(201)
  start(@StudyContext() ctx: StudyRequestContext, @Body() input: Record<string, unknown>) {
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
  @ReadJsonBody()
  @HttpCode(200)
  @UseGuards(QuizPathGuard)
  save(@StudyContext() ctx: StudyRequestContext, @Body() input: Record<string, unknown>) {
    return new QuizService(ctx.study).save(quizId(ctx), input)
  }

  /** Delegate submit to the actor's quiz service after raw path validation. */
  @Post('quizzes/:id/submit')
  @ReadJsonBody()
  @HttpCode(200)
  @UseGuards(QuizPathGuard)
  submit(@StudyContext() ctx: StudyRequestContext, @Body() input: Record<string, unknown>) {
    return new QuizService(ctx.study).submit(quizId(ctx), input)
  }

  /** Delegate pause to the actor's quiz service after raw path validation. */
  @Post('quizzes/:id/pause')
  @ReadJsonBody(true)
  @HttpCode(200)
  @UseGuards(QuizPathGuard)
  pause(@StudyContext() ctx: StudyRequestContext, @Body() input: Record<string, unknown>) {
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
}
