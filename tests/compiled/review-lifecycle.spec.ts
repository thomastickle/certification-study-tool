import { prepareRuntimeDatabase } from '../managed-database-fixture.ts'
import { NestFactory } from '@nestjs/core'
import { StudyHttpModule } from '../../src/server/study-http/study.module.ts'
import { QuizService } from '../../src/server/quizzes/quiz-service.ts'
import { populate } from '../quiz-fixtures.ts'
import {
  ReadJsonBody,
  JsonBodyInterceptor,
} from '../../src/server/security/json-body.interceptor.ts'
import 'reflect-metadata'
import assert from 'node:assert/strict'
import { Body, Controller, Get, Module, ParseIntPipe, Post, Res } from '@nestjs/common'
import { request } from 'node:http'
import type { ServerResponse } from 'node:http'
import { setImmediate } from 'node:timers/promises'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mock, test } from 'node:test'
import { createApplication } from '../../src/server/application.ts'
import { ApplicationRuntime } from '../../src/server/runtime/application-runtime.ts'
import { runtimeConfiguration } from '../../src/server/runtime/runtime-configuration.ts'
import { SecurityExpressAdapter } from '../../src/server/security/security-express-adapter.ts'
import { StudyContext, StudyRequest } from '../../src/server/security/security-context.ts'
import type { StudyRequestContext } from '../../src/server/security/security-context.ts'
import { libraryFixture } from './library-http-fixture.ts'

for (const phase of ['attachment', 'admission'] as const) {
  test(`post-create ${phase} failure closes the acquired runtime and preserves the original error`, async () => {
    const directory = mkdtempSync(join(tmpdir(), 'nest-setup-failure-'))
    const configuration = runtimeConfiguration({
      STUDY_DB_PATH: join(directory, 'library.sqlite3'),
    })
    prepareRuntimeDatabase(configuration.databasePath)
    let acquired: ApplicationRuntime | undefined
    const create = ApplicationRuntime.create
    const acquisition = mock.method(
      ApplicationRuntime,
      'create',
      async (...args: Parameters<typeof create>) => {
        acquired = await create(...args)
        return acquired
      },
    )
    const failure = new Error('Synthetic post-create failure')
    const injection =
      phase === 'attachment'
        ? mock.method(ApplicationRuntime.prototype, 'attachTransport', () => {
            throw failure
          })
        : mock.method(SecurityExpressAdapter.prototype, 'installAdmission', () => {
            throw failure
          })
    const shutdown = mock.method(ApplicationRuntime.prototype, 'onApplicationShutdown')
    try {
      await assert.rejects(createApplication(configuration), (error) => error === failure)
      assert.ok(acquired)
      assert.equal(shutdown.mock.callCount(), 1)
      assert.throws(() => acquired!.sharedLibrary.sources(), /closed|not open/)
      assert.throws(
        () =>
          acquired!.authentication.session({
            headers: { cookie: 'study_session=synthetic' },
          } as never),
        /closed|not open/,
      )
      injection.mock.restore()
      const next = await createApplication(configuration)
      await next.close()
    } finally {
      injection.mock.restore()
      acquisition.mock.restore()
      shutdown.mock.restore()
      await acquired?.onModuleDestroy()
      await acquired?.beforeApplicationShutdown()
      acquired?.onApplicationShutdown()
      rmSync(directory, { recursive: true, force: true })
    }
  })
}

const completed: boolean[] = []
let partialCompleted: (() => void) | undefined
let partialWasCancelled = false

@Controller('api/raw-lifetime')
@StudyRequest()
class RawLifetimeController {
  @Get('partial')
  async partial(@StudyContext() context: StudyRequestContext, @Res() response: ServerResponse) {
    response.write('partial')
    await new Promise<void>((resolve) =>
      context.inputSignal.addEventListener('abort', () => resolve(), { once: true }),
    )
    context.study.sources()
    partialWasCancelled = context.inputSignal.aborted
    partialCompleted?.()
  }

  @Get()
  async get(@StudyContext() context: StudyRequestContext, @Res() response: ServerResponse) {
    response.end('null')
    await setImmediate()
    context.study.sources()
    completed.push(!context.inputSignal.aborted)
  }
}

@Module({ controllers: [RawLifetimeController] })
class RawLifetimeModule {}

test('a normally finished manual response does not cancel its still-owned study work', async () => {
  const fixture = await libraryFixture(undefined, [RawLifetimeModule])
  try {
    const actor = await fixture.login('alice')
    const response = await fixture.authorized('/api/raw-lifetime', actor)
    assert.equal(response.status, 200)
    assert.equal(response.body, 'null')
    await fixture.app.close()
    assert.deepEqual(completed, [true])
  } finally {
    await fixture.close()
  }
})

test('the native Nest application preserves fluent APIs and the acquired provider graph', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'nest-api-contract-'))
  const create = NestFactory.create.bind(NestFactory)
  let native: unknown
  const capture = mock.method(NestFactory, 'create', async (...args: Parameters<typeof create>) => {
    native = await create(...args)
    return native as Awaited<ReturnType<typeof create>>
  })
  prepareRuntimeDatabase(join(directory, 'library.sqlite3'))
  const app = await createApplication(
    runtimeConfiguration({ STUDY_DB_PATH: join(directory, 'library.sqlite3') }),
  )
  capture.mock.restore()
  try {
    assert.equal(app, native, 'The factory exposes the exact Nest-created object')
    const runtime = app.get(ApplicationRuntime)
    assert.ok(app.setGlobalPrefix('v1') === app, 'Fluent configuration returns the owner')
    assert.ok((await app.init()) === app, 'Initialization returns the owner')
    assert.ok(
      (await app.listen(0, '127.0.0.1')) === app.getHttpServer(),
      'Listening returns the Nest HTTP server',
    )
    assert.equal(app.get(ApplicationRuntime), runtime)
    assert.equal(app.getHttpAdapter().getHttpServer(), app.getHttpServer())
  } finally {
    await app.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

@Controller('api/ordinary-input')
@StudyRequest()
class OrdinaryInputController {
  @Post()
  @ReadJsonBody()
  read(@Body('count', new ParseIntPipe()) count: number) {
    return { count }
  }
}

@Module({ controllers: [OrdinaryInputController], providers: [JsonBodyInterceptor] })
class OrdinaryInputModule {}

test('ordinary study endpoints support Nest Body and pipes without the joined-input metadata adapter', async () => {
  const fixture = await libraryFixture(undefined, [OrdinaryInputModule])
  try {
    const actor = await fixture.login('alice')
    const valid = await fixture.authorized(
      '/api/ordinary-input',
      actor,
      'POST',
      { 'Content-Type': 'application/json' },
      '{"count":"27"}',
    )
    assert.equal(valid.status, 201)
    assert.deepEqual(JSON.parse(valid.body), { count: 27 })
    const invalid = await fixture.authorized(
      '/api/ordinary-input',
      actor,
      'POST',
      { 'Content-Type': 'application/json' },
      '{"count":"invalid"}',
    )
    assert.equal(invalid.status, 400)
    // Native validation errors use the same study error envelope as domain validation.
    assert.deepEqual(JSON.parse(invalid.body), {
      error: 'Validation failed (numeric string is expected)',
      details: [],
    })
  } finally {
    await fixture.close()
  }
})

for (const scenario of ['invalid', 'oversized', 'expiry failure'] as const) {
  test(`earned settings expire only the verified actor before ${scenario} input`, async () => {
    const fixture = await libraryFixture(undefined, [StudyHttpModule])
    const runtime = fixture.app.get(ApplicationRuntime)
    const tick = mock.method(runtime.housekeeping, 'tick', async () => {})
    let expiration: ReturnType<typeof mock.method> | undefined
    try {
      const alice = await fixture.login('alice')
      const bob = await fixture.login('bob')
      populate(runtime.sharedLibrary)

      const createAttempt = (session: string) => {
        const personal = runtime.privateLibraries.open(fixture.sessions.get(session)!)
        try {
          return new QuizService(
            runtime.sharedLibrary.forAccount(fixture.sessions.get(session)!, personal),
            () => 1,
          ).start({ sourceFilter: 'mixed', questionType: 'mixed' }).id
        } finally {
          personal.close()
        }
      }

      const aliceId = createAttempt(alice)
      const bobId = createAttempt(bob)
      if (scenario === 'expiry failure') {
        expiration = mock.method(QuizService.prototype, 'expireDue', () => {
          throw new Error('Synthetic expiry failure')
        })
      }
      const body = scenario === 'oversized' ? 'x'.repeat(10 * 1024 * 1024 + 1) : '{'
      const response = await fixture.authorized(
        '/api/certifications/earned',
        alice,
        'PUT',
        { 'Content-Type': 'application/json' },
        body,
      )
      const expectedStatus = { invalid: 400, oversized: 413, 'expiry failure': 500 }[scenario]
      assert.equal(response.status, expectedStatus)

      for (const [actor, id] of [
        [alice, aliceId],
        [bob, bobId],
      ]) {
        const personal = runtime.privateLibraries.open(fixture.sessions.get(actor!)!)
        try {
          assert.equal(
            personal.quizStore().find(id!)!.status,
            actor === alice && scenario !== 'expiry failure' ? 'completed' : 'active',
          )
        } finally {
          personal.close()
        }
      }
    } finally {
      expiration?.mock.restore()
      tick.mock.restore()
      await fixture.close()
    }
  })
}

test(
  'a real mid-response disconnect cancels work while its personal storage remains owned',
  { timeout: 10000 },
  async () => {
    const fixture = await libraryFixture(undefined, [RawLifetimeModule])
    try {
      const actor = await fixture.login('alice')
      const cancelled = new Promise<void>((resolve) => {
        partialCompleted = resolve
      })
      const req = request(
        {
          host: '127.0.0.1',
          port: fixture.port,
          path: '/api/raw-lifetime/partial',
          headers: {
            Host: fixture.config.origin.host,
            Cookie: actor,
            'X-Study-Account': fixture.sessions.get(actor)!,
          },
        },
        (response) => {
          response.on('error', () => {})
          response.once('data', () => req.destroy())
          response.resume()
        },
      )
      req.on('error', () => {})
      req.end()
      await cancelled
      await fixture.app.close()
      assert.equal(partialWasCancelled, true)
    } finally {
      partialCompleted = undefined
      await fixture.close()
    }
  },
)

test('startup owner preserves init failure when cleanup fails and shares shutdown rejection', async () => {
  const { ApplicationOwner } = await import('../../src/server/runtime/application-owner.ts')
  const directory = mkdtempSync(join(tmpdir(), 'nest-owner-failure-'))
  const failure = new Error('Synthetic initialization failure')
  const cleanupFailure = new Error('Synthetic disposal failure')
  prepareRuntimeDatabase(join(directory, 'library.sqlite3'))
  const app = await createApplication(
    runtimeConfiguration({ STUDY_DB_PATH: join(directory, 'library.sqlite3') }),
    [
      {
        module: OrdinaryInputModule,
        providers: [
          {
            provide: 'FailInit',
            useValue: {
              onModuleInit() {
                throw failure
              },
            },
          },
        ],
      },
    ],
  )
  const owner = new ApplicationOwner(Promise.resolve(app))
  const adapter = app.getHttpAdapter()
  const disposal = mock.method(adapter, 'close', async () => {
    throw cleanupFailure
  })
  try {
    await assert.rejects(owner.start(0, '127.0.0.1'), (error) => error === failure)
    assert.equal(owner.close(), owner.close())
    await assert.rejects(owner.close(), (error) => error === cleanupFailure)
  } finally {
    disposal.mock.restore()
    await app.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
