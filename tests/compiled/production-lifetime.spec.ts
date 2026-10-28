import 'reflect-metadata'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mock, test } from 'node:test'
import { ApplicationRuntime } from '../../src/server/runtime/application-runtime.ts'
import { AccountRepository } from '../../src/server/auth/account-repository.ts'
import { createProductionApplication } from '../../src/server/production-application.ts'
import type { LibraryRepository } from '../../src/server/questions/library-repository.ts'
import { runtimeConfiguration } from '../../src/server/runtime/runtime-configuration.ts'

for (const disconnect of [false, true]) {
  test(
    `production Nest HTTP keeps private storage across a deferred body and drains it before roots (disconnect=${disconnect})`,
    { timeout: 10000 },
    async () => {
      const directory = mkdtempSync(join(tmpdir(), 'study-transport-'))
      writeFileSync(join(directory, 'index.html'), '<!doctype html><title>fixture</title>')
      const configuration = runtimeConfiguration({
        STUDY_DB_PATH: join(directory, 'library.sqlite3'),
        NODE_ENV: 'production',
      })
      configuration.port = 0
      configuration.staticRoot = directory
      const app = await createProductionApplication(configuration)
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
        await app.init()
        await app.listen(0, '127.0.0.1')
        const server = app.getHttpServer()
        const address = server.address()
        assert.ok(address && typeof address !== 'string')
        const origin = `http://127.0.0.1:${address.port}`
        // Origin is explicit so the real admission policy is exercised on the ephemeral listener.
        configuration.origin.port = String(address.port)
        const accounts = new AccountRepository(configuration.authentication.accountsPath)
        const actor = accounts.identify({
          issuer: configuration.authentication.issuer,
          subject: 'fixture',
          name: 'Fixture',
        })
        accounts.saveSession('synthetic-session', actor.id, Date.now() + 60000)
        accounts.close()
        const req = request(`${origin}/api/quizzes`, {
          method: 'POST',
          headers: {
            Origin: origin,
            Cookie: 'study_session=synthetic-session',
            'X-Study-Account': actor.id,
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
        rmSync(directory, { recursive: true, force: true })
      }
    },
  )
}
