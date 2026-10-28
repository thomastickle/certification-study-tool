import 'reflect-metadata'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mock, test } from 'node:test'
import { ApplicationRuntime } from '../../src/server/application-runtime.ts'
import { libraryFixture } from './library-http-fixture.ts'
import { StudyHttpModule } from '../../src/server/study-http/study.module.ts'
import { createProductionApplication } from '../../src/server/production-application.ts'
import { observeRuntime } from './runtime-observation.ts'
import type { LibraryRepository } from '../../src/server/questions/library-repository.ts'
import { runtimeConfiguration } from '../../src/server/runtime-configuration.ts'

for (const disconnect of [false, true]) {
  test(
    `real HTTP keeps private storage across a deferred body and drains it before roots (disconnect=${disconnect})`,
    { timeout: 10000 },
    async () => {
      const fixture = await libraryFixture(undefined, [StudyHttpModule])
      const app = fixture.app
      const configuration = fixture.config
      const session = await fixture.login('alice')
      const actor = fixture.sessions.get(session)!
      const runtime = app.get(ApplicationRuntime)
      let entered!: () => void
      const opened = new Promise<void>((resolve) => {
        entered = resolve
      })
      let observed!: () => void
      const observation = new Promise<void>((resolve) => {
        observed = resolve
      })
      let personal: LibraryRepository | undefined
      const originalOpen = runtime.privateLibraries.open.bind(runtime.privateLibraries)
      const open = mock.method(runtime.privateLibraries, 'open', (id: string) => {
        personal = originalOpen(id)
        entered()
        return personal
      })
      const originalObserve = runtime.housekeeping.observeRequest.bind(runtime.housekeeping)
      const observe = mock.method(
        runtime.housekeeping,
        'observeRequest',
        (...args: Parameters<typeof originalObserve>) => {
          args[2].quizStore().nextHousekeepingAt()
          originalObserve(...args)
          observed()
        },
      )
      try {
        const server = app.getHttpServer() as import('node:http').Server
        const address = server.address()
        assert.ok(address && typeof address !== 'string')
        const origin = `http://127.0.0.1:${address.port}`
        // Origin is explicit so the real admission policy is exercised on the ephemeral listener.
        configuration.origin.port = String(address.port)
        const req = request(`${origin}/api/quizzes`, {
          method: 'POST',
          headers: {
            Origin: origin,
            Cookie: session,
            'X-Study-Account': actor,
            'Content-Type': 'application/json',
            'Content-Length': '2',
          },
        })
        req.on('error', () => {})
        const response = once(req, 'response')
        void response.catch(() => {})
        req.write('{')
        await opened
        assert.ok(personal)
        personal.quizStore().nextHousekeepingAt()
        assert.equal(observe.mock.callCount(), 0)
        if (disconnect) {
          // Shutdown aborts the unfinished body; request cleanup must settle before root disposal.
          const closing = app.close()
          await observation
          await closing
          await response.catch(() => {})
        } else {
          req.end('}')
          const [received] = await response
          received.resume()
          await once(received, 'end')
          assert.equal(received.statusCode, 400)
          await observation
          runtime.sharedLibrary.quizStore().nextHousekeepingAt()
          await app.close()
        }
        assert.equal(observe.mock.callCount(), 1)
        assert.throws(() => personal!.quizStore().nextHousekeepingAt(), /closed|not open/)
        assert.throws(
          () => runtime.sharedLibrary.quizStore().nextHousekeepingAt(),
          /closed|not open/,
        )
        await app.close()
      } finally {
        open.mock.restore()
        observe.mock.restore()
        await app.close()
        await fixture.close()
      }
    },
  )
}

test('listen and missing-static failures can close their already initialized Nest graph', async () => {
  const occupied = createServer()
  await new Promise<void>((resolve) => occupied.listen(0, '127.0.0.1', resolve))
  const address = occupied.address()
  assert.ok(address && typeof address !== 'string')
  try {
    for (const missingStatic of [false, true]) {
      const directory = mkdtempSync(join(tmpdir(), 'study-transport-failure-'))
      if (!missingStatic) {
        writeFileSync(join(directory, 'index.html'), 'fixture')
      }
      const configuration = runtimeConfiguration({
        STUDY_DB_PATH: join(directory, 'library.sqlite3'),
        NODE_ENV: 'production',
        STUDY_PORT: String(address.port),
      })
      configuration.staticRoot = directory
      const captured = observeRuntime()
      try {
        await assert.rejects(
          (async () => {
            const app = await createProductionApplication(configuration)
            await app.listen(configuration.port, configuration.host)
          })(),
          missingStatic ? /npm run build/ : /EADDRINUSE/,
        )
        captured.restore()
        assert.throws(
          () => captured.runtime.sharedLibrary.quizStore().nextHousekeepingAt(),
          /closed|not open/,
        )
        assert.throws(
          () => captured.runtime.authentication.legacyOwnerId('closed'),
          /closed|not open/,
        )
      } finally {
        captured.restore()
        rmSync(directory, { recursive: true, force: true })
      }
    }
  } finally {
    await new Promise<void>((resolve) => occupied.close(() => resolve()))
  }
})
