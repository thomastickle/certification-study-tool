import {
  Controller,
  Get,
  HttpCode,
  Inject,
  Injectable,
  Module,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common'
import type { ServerResponse } from 'node:http'
import {
  JsonObjectBody,
  LibraryWrite,
  NormalizedQuery,
  NormalizedUrl,
  StudyContext,
  StudyRequest,
  VerifiedActor,
} from '../../src/server/security-context.ts'
import type { StudyRequestContext } from '../../src/server/security-context.ts'
import type { SessionUser } from '../../src/shared/auth-contracts.ts'
import type { RequestUrl } from '../../src/server/request-url.ts'
import { ImportService } from '../../src/server/importer/import-service.ts'
import { ApplicationError } from '../../src/server/errors.ts'
import { ApplicationRuntime } from '../../src/server/application-runtime.ts'
import { ApplicationAuthentication } from '../../src/server/auth/application-authentication.ts'
import { RUNTIME_CONFIGURATION } from '../../src/server/runtime-configuration.ts'
import type { RuntimeConfiguration } from '../../src/server/runtime-configuration.ts'
import { StudyLibraryScope } from '../../src/server/study-library-scope.ts'
import { SHARED_LIBRARY_REPOSITORY } from '../../src/server/runtime.module.ts'
import { LibraryRepository } from '../../src/server/questions/library-repository.ts'

/** Per-app controls; never replace production providers or keep global test overrides. */
@Injectable()
export class ProbeWork {
  entered: (() => void) | undefined
  release: Promise<void> = Promise.resolve()
  personal: LibraryRepository | undefined
  bodyRead = 0
}

/** Suspend a later guard to prove shutdown owns the gap before scope interception starts. */
@Injectable()
export class ProbeSlowGuard {
  constructor(@Inject(ProbeWork) private readonly work: ProbeWork) {}

  async canActivate(): Promise<boolean> {
    this.work.entered?.()
    await this.work.release
    return true
  }
}

/** Test-only controllers exercise the public stage-four API on real compiled Nest routing. */
@Controller('api/probe')
@StudyRequest()
export class ProbeController {
  constructor(@Inject(ProbeWork) private readonly work: ProbeWork) {}

  @Get()
  read(
    @VerifiedActor() actor: SessionUser,
    @NormalizedQuery() query: URLSearchParams,
    @NormalizedUrl() url: RequestUrl,
    @StudyContext() context: StudyRequestContext,
  ) {
    return {
      actor,
      first: query.get('value'),
      url,
      frozen: Object.isFrozen(url),
      sources: context.content('private').sources(),
    }
  }

  @Post('shared')
  @HttpCode(200)
  @LibraryWrite('shared')
  shared(@JsonObjectBody() body: Record<string, unknown>) {
    this.work.bodyRead++
    return body
  }

  @Post('private')
  @HttpCode(200)
  @LibraryWrite('private')
  privateWrite(
    @JsonObjectBody() body: Record<string, unknown>,
    @StudyContext() context: StudyRequestContext,
  ) {
    this.work.bodyRead++
    return { body, actor: context.actor.id, sources: context.content('private').sources() }
  }

  @Post('bank')
  @LibraryWrite('private')
  bank(
    @JsonObjectBody() body: Record<string, unknown>,
    @StudyContext() context: StudyRequestContext,
  ) {
    const service = new ImportService(context.personal)
    return service.confirm(body.bank, service.preview(body.bank).token, false)
  }

  @Post('pause')
  @HttpCode(200)
  pause(@JsonObjectBody(true) body: Record<string, unknown>) {
    return body
  }

  @Post('wait')
  async wait(@StudyContext() context: StudyRequestContext) {
    this.work.personal = context.personal
    this.work.entered?.()
    await this.work.release
    context.personal.sources()
    return { ok: true }
  }

  @Get('guard-wait')
  @UseGuards(ProbeSlowGuard)
  guarded(@StudyContext() context: StudyRequestContext) {
    return context.personal.sources()
  }

  @Get('item/:id')
  item(@NormalizedUrl() url: RequestUrl) {
    return { path: url.pathname }
  }

  @Get('error')
  error() {
    throw new ApplicationError('Invalid selection.', 400, ['Choose a source.'])
  }

  @Get('unexpected')
  unexpected() {
    throw new Error('synthetic-private-diagnostic')
  }

  @Get('partial')
  partial(@Res() response: ServerResponse) {
    response.write('partial')
    throw new Error('synthetic-private-diagnostic')
  }

  @Get('ended')
  ended(@Res() response: ServerResponse) {
    response.end('complete')
    throw new Error('synthetic-private-diagnostic')
  }
}

/** Resolve aliases from a separate feature module with no independent runtime registration. */
@Injectable()
export class FeatureAliases {
  constructor(
    @Inject(ApplicationRuntime) readonly runtime: ApplicationRuntime,
    @Inject(ApplicationAuthentication) readonly auth: ApplicationAuthentication,
    @Inject(RUNTIME_CONFIGURATION) readonly config: RuntimeConfiguration,
    @Inject(StudyLibraryScope) readonly scope: StudyLibraryScope,
    @Inject(SHARED_LIBRARY_REPOSITORY) readonly shared: LibraryRepository,
  ) {}
}

@Module({ providers: [FeatureAliases], exports: [FeatureAliases] })
export class OtherFeatureModule {}

@Module({
  imports: [OtherFeatureModule],
  controllers: [ProbeController],
  providers: [ProbeWork, ProbeSlowGuard],
})
export class ProbeModule {}

@Module({})
export class FailureModule {}
