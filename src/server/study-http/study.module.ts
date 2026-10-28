import {
  Controller,
  Get,
  Put,
  Module,
  createParamDecorator,
  Post,
  Delete,
  HttpCode,
  UseGuards,
  Injectable,
  Header,
} from '@nestjs/common'
import { StudyContext, StudyRequest, JsonObjectBody } from '../security-context.ts'
import type { StudyRequestContext, AdmittedRequest } from '../security-context.ts'
import { HomeService } from '../home/home-service.ts'
import { QuizService } from '../quizzes/quiz-service.ts'

import type { CanActivate, ExecutionContext } from '@nestjs/common'
import { ApplicationError } from '../errors.ts'
import { ReportService } from '../reports/report-service.ts'
import { parseLibraryItemId } from '../../shared/library-identity.ts'
import { jsonObjectBody } from '../json-object-body.ts'

/** Keep earned-settings expiry ahead of body parsing, including invalid bodies. */
const EarnedBody = createParamDecorator((_data, context) => {
  const request = context.switchToHttp().getRequest<AdmittedRequest>()
  const ctx = request.studyContext!
  new QuizService(ctx.study).expireDue()
  return jsonObjectBody(request, false, request.inputWork!.signal)
})

/** Expose actor-owned home state without retaining the request's storage. */
@Controller('api')
@StudyRequest()
class HomeController {
  /** Expire active deadlines before calculating readiness. */
  @Get('home')
  home(@StudyContext() ctx: StudyRequestContext) {
    new QuizService(ctx.study).expireDue()
    return new HomeService(ctx.study).get()
  }

  /** Preserve expiry before body validation, as in the legacy handler. */
  @Put('certifications/earned')
  earned(@StudyContext() ctx: StudyRequestContext, @EarnedBody() input: Record<string, unknown>) {
    return new HomeService(ctx.study).setEarned(input)
  }
}

/** Match the admitted, still-encoded pathname before any body work. */
@Injectable()
class QuizPathGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AdmittedRequest>()
    if (
      !/^\/api\/quizzes\/[a-f0-9-]{36}(?:\/(answers|submit|abandon|pause|resume|restore))?$/.test(
        request.admission.url.pathname,
      )
    ) {
      throw new ApplicationError('Not found.', 404)
    }
    return true
  }
}

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
class StudyController {
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
  @UseGuards(QuizPathGuard)
  remove(@StudyContext() ctx: StudyRequestContext) {
    const permanent = ctx.query.get('permanent')
    if (permanent !== null && permanent !== 'true' && permanent !== 'false') {
      throw new ApplicationError('Choose a valid permanent deletion option.')
    }
    return new QuizService(ctx.study).deleteResult(quizId(ctx), permanent === 'true')
  }
}

@Module({ controllers: [HomeController, StudyController], providers: [QuizPathGuard] })
export class StudyHttpModule {}
