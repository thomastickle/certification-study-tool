import { prepareRuntimeDatabase } from '../managed-database-fixture.ts'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mock, test } from 'node:test'
import { createApplication } from '../../src/server/application.ts'
import { ApplicationRuntime } from '../../src/server/runtime/application-runtime.ts'
import { SecurityExpressAdapter } from '../../src/server/security/security-express-adapter.ts'
import { runtimeConfiguration } from '../../src/server/runtime/runtime-configuration.ts'

for (const phase of ['attachment', 'admission']) {
  test(`post-create ${phase} failure closes the acquired graph before rejecting`, async () => {
    const directory = mkdtempSync(join(tmpdir(), 'nest-setup-failure-'))
    const config = runtimeConfiguration({ STUDY_DB_PATH: join(directory, 'library.sqlite3') })
    prepareRuntimeDatabase(config.databasePath)
    const create = ApplicationRuntime.create
    let acquired: ApplicationRuntime | undefined
    const acquisition = mock.method(
      ApplicationRuntime,
      'create',
      async (...args: Parameters<typeof create>) => {
        acquired = await create(...args)
        return acquired
      },
    )
    const failure = new Error(`Synthetic ${phase} failure`)
    const injected =
      phase === 'attachment'
        ? mock.method(ApplicationRuntime.prototype, 'attachTransport', () => {
            throw failure
          })
        : mock.method(SecurityExpressAdapter.prototype, 'installAdmission', () => {
            throw failure
          })
    try {
      await assert.rejects(createApplication(config), (error: unknown) => error === failure)
      assert.ok(acquired)
      assert.throws(
        () => acquired!.sharedLibrary.quizStore().nextHousekeepingAt(),
        /closed|not open/,
      )
      assert.throws(
        () => Reflect.get(acquired!.authentication, 'accounts').findIdentity('synthetic', 'probe'),
        /closed|not open/,
      )
      assert.equal(Reflect.get(acquired, 'timer'), undefined)
      injected.mock.restore()
      const healthy = await createApplication(config)
      await healthy.listen(0, '127.0.0.1')
      await healthy.close()
    } finally {
      injected.mock.restore()
      acquisition.mock.restore()
      // Release the known leaked baseline graph after a red assertion, too.
      if (acquired) {
        await acquired.onModuleDestroy()
        await acquired.beforeApplicationShutdown()
        acquired.onApplicationShutdown()
      }
      rmSync(directory, { recursive: true, force: true })
    }
  })
}
