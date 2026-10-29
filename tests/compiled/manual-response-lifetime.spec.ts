import { Controller, Get, Module, Res } from '@nestjs/common'
import type { ServerResponse } from 'node:http'
import { request } from 'node:http'
import { once } from 'node:events'
import assert from 'node:assert/strict'
import { mock, test } from 'node:test'
import { setImmediate } from 'node:timers/promises'
import { StudyContext, StudyRequest } from '../../src/server/security/security-context.ts'
import type { StudyRequestContext } from '../../src/server/security/security-context.ts'
import { StudyInputWork } from '../../src/server/security/study-input-work.ts'
import { libraryFixture } from './library-http-fixture.ts'

/** Return a raw response while asynchronous work still owns its storage. */
@Controller('api/manual-lifetime')
@StudyRequest()
class ManualController {
  @Get('complete')
  async complete(@StudyContext() context: StudyRequestContext, @Res() response: ServerResponse) {
    response.end('complete')
    await setImmediate()
    context.personal.sources()
  }

  @Get('partial')
  async partial(@StudyContext() context: StudyRequestContext, @Res() response: ServerResponse) {
    response.write('partial')
    await once(context.inputSignal, 'abort')
    context.personal.sources()
  }
}

@Module({ controllers: [ManualController] })
class ManualModule {}

for (const interrupted of [false, true]) {
  test(
    `manual response resource settlement distinguishes premature close (${interrupted})`,
    { timeout: 10000 },
    async () => {
      const f = await libraryFixture(undefined, [ManualModule])
      const session = await f.login('alice')
      const original = StudyInputWork.prototype.settle
      let finished!: (result: unknown) => void
      const settlement = new Promise<unknown>((resolve) => {
        finished = resolve
      })
      const observation = mock.method(
        StudyInputWork.prototype,
        'settle',
        async function (this: StudyInputWork) {
          try {
            await original.call(this)
            finished(undefined)
          } catch (error) {
            finished(error)
            throw error
          }
        },
      )
      try {
        if (interrupted) {
          const req = request({
            host: '127.0.0.1',
            port: f.port,
            path: '/api/manual-lifetime/partial',
            headers: {
              Host: f.config.origin.host,
              Cookie: session,
              'X-Study-Account': f.sessions.get(session)!,
            },
          })
          req.on('error', () => {})
          const received = once(req, 'response')
          req.end()
          const [response] = await received
          response.on('error', () => {})
          await once(response, 'data')
          response.destroy()
        } else {
          const response = await f.authorized('/api/manual-lifetime/complete', session)
          assert.equal(response.status, 200)
          assert.equal(response.body, 'complete')
        }
        const result = await settlement
        if (interrupted) {
          assert.match(String(result), /interrupted/)
        } else {
          assert.equal(result, undefined)
        }
      } finally {
        await f.close()
        observation.mock.restore()
      }
    },
  )
}
