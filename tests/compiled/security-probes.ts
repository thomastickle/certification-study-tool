import {
  Body,
  createParamDecorator,
  Controller,
  Get,
  HttpCode,
  Inject,
  Injectable,
  Module,
  Post,
  Res,
  UseGuards,
  UsePipes,
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
} from '../../src/server/security/security-context.ts'
import type { StudyRequestContext } from '../../src/server/security/security-context.ts'
import type { SessionUser } from '../../src/shared/auth-contracts.ts'
import type { RequestUrl } from '../../src/server/http/request-url.ts'
import { ImportService } from '../../src/server/importer/import-service.ts'
import { ApplicationError } from '../../src/server/http/errors.ts'
import { ApplicationRuntime } from '../../src/server/runtime/application-runtime.ts'
import { ApplicationAuthentication } from '../../src/server/auth/application-authentication.ts'
import { RUNTIME_CONFIGURATION } from '../../src/server/runtime/runtime-configuration.ts'
import type { RuntimeConfiguration } from '../../src/server/runtime/runtime-configuration.ts'
import { StudyLibraryScope } from '../../src/server/runtime/study-library-scope.ts'
import { SHARED_LIBRARY_REPOSITORY } from '../../src/server/runtime/runtime.module.ts'
import { LibraryRepository } from '../../src/server/questions/library-repository.ts'

/** Per-app controls; never replace production providers or keep global test overrides. */
@Injectable()
export class ProbeWork {
  entered: (() => void) | undefined
  release: Promise<void> = Promise.resolve()
  personal: LibraryRepository | undefined
  bodyRead = 0
  guardRequest?: import('../../src/server/security/security-context.ts').AdmittedRequest
  guardClosed: (() => void) | undefined
  inputEntered: (() => void) | undefined
  failureEntered: (() => void) | undefined
  beforeFailure: Promise<void> = Promise.resolve()
  inputRelease: Promise<void> = Promise.resolve()
  lateRead = false
  inputControllerCalls = 0
  cooperativeCleanup = false
  bodyEntered: (() => void) | undefined
  bodyRequest?: import('../../src/server/security/security-context.ts').AdmittedRequest
}

/** Suspend a later guard to prove shutdown owns the gap before scope interception starts. */
@Injectable()
export class ProbeSlowGuard {
  constructor(@Inject(ProbeWork) private readonly work: ProbeWork) {}

  async canActivate(context: import('@nestjs/common').ExecutionContext): Promise<boolean> {
    this.work.guardRequest = context.switchToHttp().getRequest()
    context
      .switchToHttp()
      .getResponse<ServerResponse>()
      .once('close', () => {
        this.work.guardClosed?.()
      })
    this.work.entered?.()
    await this.work.release
    return true
  }
}

/** Deliberately use ordinary Nest custom factories, including an asynchronous instance pipe. */
const PendingResource = createParamDecorator(
  async (_data: unknown, context: import('@nestjs/common').ExecutionContext) => {
    const request = context.switchToHttp().getRequest<
      import('../../src/server/security/security-context.ts').AdmittedRequest & {
        inputProbe: ProbeWork
      }
    >()
    const work = request.inputProbe
    work.personal = request.studyContext!.personal
    work.inputEntered?.()
    await work.inputRelease
    work.personal.sources()
    work.lateRead = true
    return 'resolved'
  },
)

const RejectSibling = createParamDecorator(
  async (_data: unknown, context: import('@nestjs/common').ExecutionContext) => {
    const request = context.switchToHttp().getRequest<{ inputProbe: ProbeWork }>()
    await request.inputProbe.beforeFailure
    request.inputProbe.failureEntered?.()
    throw new ApplicationError('Synthetic parameter rejection.', 400)
  },
)

const PipeResource = createParamDecorator(
  (_data: unknown, context: import('@nestjs/common').ExecutionContext) => {
    const request = context.switchToHttp().getRequest<
      import('../../src/server/security/security-context.ts').AdmittedRequest & {
        inputProbe: ProbeWork
      }
    >()
    request.inputProbe.personal = request.studyContext!.personal
    return request.inputProbe
  },
)

const pendingResourcePipe = {
  async transform(work: ProbeWork) {
    work.inputEntered?.()
    await work.inputRelease
    work.personal!.sources()
    work.lateRead = true
    return 'transformed'
  },
}

const CaptureBody = createParamDecorator(
  (_data: unknown, context: import('@nestjs/common').ExecutionContext) => {
    const request = context.switchToHttp().getRequest<
      import('../../src/server/security/security-context.ts').AdmittedRequest & {
        inputProbe: ProbeWork
      }
    >()
    const work = request.inputProbe
    work.personal = request.studyContext!.personal
    work.bodyRequest = request
    const read = request.read.bind(request)
    request.read = (...args: Parameters<typeof read>) => {
      work.bodyEntered?.()
      return read(...args)
    }
    return null
  },
)

const CooperativeResource = createParamDecorator(
  (_data: unknown, context: import('@nestjs/common').ExecutionContext) => {
    const request = context.switchToHttp().getRequest<
      import('../../src/server/security/security-context.ts').AdmittedRequest & {
        inputProbe: ProbeWork
      }
    >()
    const work = request.inputProbe
    work.personal = request.studyContext!.personal
    return new Promise((resolve) => {
      request.studyContext!.inputSignal.addEventListener(
        'abort',
        () => {
          work.personal!.sources()
          work.cooperativeCleanup = true
          resolve('cancelled')
        },
        { once: true },
      )
      work.inputEntered?.()
    })
  },
)

const ParameterValue = createParamDecorator((data: string) => data)

const parameterMetadataPipe = {
  transform(value: unknown, metadata: import('@nestjs/common').ArgumentMetadata) {
    return {
      value,
      data: metadata.data,
      type: metadata.type,
      metatype: metadata.metatype?.name,
      order: ['first'],
    }
  },
}

const secondParameterPipe = {
  async transform(value: { order: string[] }) {
    return { ...value, order: [...value.order, 'second'] }
  },
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

  @Get('input-factory')
  inputFactory(@PendingResource() _pending: unknown, @RejectSibling() _failure: unknown) {
    this.work.inputControllerCalls++
    return 'must not execute'
  }

  @Get('input-pipe')
  inputPipe(
    @PipeResource(pendingResourcePipe) _pending: unknown,
    @RejectSibling() _failure: unknown,
  ) {
    this.work.inputControllerCalls++
    return 'must not execute'
  }

  @Post('input-body')
  inputBody(
    @JsonObjectBody() _body: Record<string, unknown>,
    @RejectSibling() _failure: unknown,
    @CaptureBody() _capture: unknown,
    @StudyContext() context: StudyRequestContext,
  ) {
    this.work.personal = context.personal
    this.work.inputControllerCalls++
    return 'must not execute'
  }

  @Get('input-cooperative')
  cooperative(@CooperativeResource() _pending: unknown, @RejectSibling() _failure: unknown) {
    this.work.inputControllerCalls++
    return 'must not execute'
  }

  @Get('input-metadata')
  metadata(@ParameterValue('selection', parameterMetadataPipe, secondParameterPipe) value: string) {
    return value
  }

  @Get('input-success')
  inputSuccess(@PendingResource() value: unknown) {
    this.work.inputControllerCalls++
    return { value }
  }

  @Get('guard-wait')
  @UseGuards(ProbeSlowGuard)
  guarded(@StudyContext() context: StudyRequestContext) {
    return context.personal.sources()
  }

  @Get('guard-cooperative')
  @UseGuards(ProbeSlowGuard)
  guardedCooperative(@CooperativeResource() value: unknown) {
    this.work.inputControllerCalls++
    return value
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

@Controller('api/unowned-input')
@StudyRequest()
export class UnownedBodyController {
  @Post()
  read(@Body() value: unknown) {
    return value
  }
}

@Controller('api/unowned-pipe')
@StudyRequest()
export class UnownedPipeController {
  @Get()
  @UsePipes({
    transform(value: unknown) {
      return value
    },
  })
  read(@StudyContext() context: StudyRequestContext) {
    return context.actor.id
  }
}

@Controller('api/unscoped-body')
export class UnscopedBodyController {
  @Post()
  read(@JsonObjectBody() value: unknown) {
    return value
  }
}

@Module({ controllers: [UnownedBodyController] })
export class UnownedBodyModule {}

@Module({ controllers: [UnownedPipeController] })
export class UnownedPipeModule {}

@Module({ controllers: [UnscopedBodyController] })
export class UnscopedBodyModule {}

@Injectable()
class UnownedClassPipe {
  transform(value: unknown) {
    return value
  }
}

@Controller('api/unowned-class-pipe')
@StudyRequest()
class UnownedClassPipeController {
  @Get()
  read(@StudyContext(UnownedClassPipe) context: StudyRequestContext) {
    return context.actor.id
  }
}

@Module({ controllers: [UnownedClassPipeController] })
export class UnownedClassPipeModule {}

/** Use emitted concrete-handler types while inheriting the base parameter decorators. */
export function inheritedInputModule(reverse: boolean) {
  @Controller('api/inherited-base')
  @StudyRequest()
  class Base {
    @Get()
    read(
      @ParameterValue('inherited', parameterMetadataPipe, secondParameterPipe) value: unknown,
    ): unknown {
      return value
    }
  }

  @Controller('api/inherited-derived')
  class Derived extends Base {
    @Get()
    override read(value: string): unknown {
      return value
    }
  }

  @Module({ controllers: reverse ? [Derived, Base] : [Base, Derived] })
  class InheritedInputModule {}

  return InheritedInputModule
}
