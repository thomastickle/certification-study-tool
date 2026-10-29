import { prepareRuntimeDatabase } from '../managed-database-fixture.ts'
import { libraryFixture } from './library-http-fixture.ts'
import assert from 'node:assert/strict'
import { Controller, Get, Inject, Module, Scope } from '@nestjs/common'
import { mock, test } from 'node:test'
import { setImmediate } from 'node:timers/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createApplication } from '../../src/server/application.ts'
import { ApplicationAuthentication } from '../../src/server/auth/application-authentication.ts'
import { PublicWeb } from '../../src/server/web/public-web.ts'
import { runtimeConfiguration } from '../../src/server/runtime/runtime-configuration.ts'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

@Controller('/api/failure')
class FailureController {
  @Get()
  async fail() {
    await Promise.resolve()
    throw new Error('Sensitive study failure detail')
  }
}

const REQUEST_CONSTRUCTION = Symbol('RequestConstructionFailure')

@Controller('/api/construction')
class ConstructionFailureController {
  constructor(@Inject(REQUEST_CONSTRUCTION) private readonly dependency: object) {}

  @Get()
  get() {
    return this.dependency
  }
}

@Module({
  controllers: [FailureController, ConstructionFailureController],
  providers: [
    {
      provide: REQUEST_CONSTRUCTION,
      scope: Scope.REQUEST,
      useFactory: () => {
        throw new Error('Sensitive controller construction failure detail')
      },
    },
  ],
})
class FailureModule {}

for (const failure of ['web', 'partial', 'ended'] as const) {
  test(`real Nest contains ${failure} failure and remains available`, async () => {
    const directory = mkdtempSync(join(tmpdir(), 'nest-request-failure-'))
    const configuration = runtimeConfiguration({
      STUDY_DB_PATH: join(directory, 'library.sqlite3'),
    })
    prepareRuntimeDatabase(configuration.databasePath)
    // This focused public owner bypasses asset acquisition, not Nest admission or exception handling.
    const web = new PublicWeb(async (request: IncomingMessage, response: ServerResponse) => {
      if (request.url === '/healthy') {
        response.end('Available')
        return
      }
      if (failure === 'partial') {
        response.writeHead(200)
        response.write('Partial')
      }
      if (failure === 'ended') {
        response.writeHead(200)
        response.end('Complete')
      }
      await setImmediate()
      throw new Error('Sensitive web failure detail')
    })
    const initialize = mock.method(web, 'initialize', async () => {})
    const app = await createApplication(configuration, [FailureModule], web)
    try {
      await app.listen(0, '127.0.0.1')
      const address = (app.getHttpServer() as import('node:http').Server).address()
      assert.ok(address && typeof address !== 'string')
      const origin = `http://127.0.0.1:${address.port}`
      configuration.origin.port = String(address.port)
      const body = fetch(origin + '/fail').then(async (response) => {
        if (failure !== 'partial' && failure !== 'ended') {
          assert.equal(response.status, 500)
          assert.equal(response.headers.get('cache-control'), 'no-store')
          assert.deepEqual(await response.json(), {
            error: 'The request could not be completed. Please retry.',
          })
          return
        }
        return response.text()
      })
      if (failure === 'partial') {
        await assert.rejects(body, /terminated|fetch failed/)
      } else if (failure === 'ended') {
        assert.equal(await body, 'Complete')
      } else {
        await body
      }
      assert.equal(await (await fetch(origin + '/healthy')).text(), 'Available')
    } finally {
      initialize.mock.restore()
      await app.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })
}

for (const failure of ['authentication', 'study', 'controller construction'] as const) {
  test(`Nest ${failure} failure is sanitized and leaves HTTP available`, async () => {
    const f = await libraryFixture(undefined, [FailureModule])
    let admission: ReturnType<typeof mock.method> | undefined
    try {
      const actor = await f.login('alice')
      if (failure === 'authentication') {
        const authentication = f.app.get(ApplicationAuthentication)
        const admit = authentication.admit.bind(authentication)
        admission = mock.method(authentication, 'admit', (request: IncomingMessage) => {
          if (request.url === '/api/failure') {
            throw new Error('Sensitive authentication failure detail')
          }
          return admit(request)
        })
      }
      const target = failure === 'controller construction' ? '/api/construction' : '/api/failure'
      const failed = await f.authorized(target, actor)
      assert.equal(failed.status, 500)
      assert.equal(failed.headers['cache-control'], 'no-store')
      assert.deepEqual(JSON.parse(failed.body), {
        error:
          failure === 'study'
            ? 'The local operation failed. No partial import was saved.'
            : 'The request could not be completed. Please retry.',
      })
      assert.equal((await f.call('/api/health')).status, 200)
    } finally {
      admission?.mock.restore()
      await f.close()
    }
  })
}
