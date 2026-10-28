import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mock, test } from 'node:test'
import { StudyLibraryScope } from '../src/server/study-library-scope.ts'
import { PrivateLibraries } from '../src/server/questions/private-libraries.ts'
import type { LibraryRepository } from '../src/server/questions/library-repository.ts'

const actor = {
  id: '12345678-1234-1234-1234-123456789abc',
  name: 'Fixture',
  role: 'student' as const,
}

for (const observationFails of [false, true]) {
  for (const failedWork of [false, true]) {
    test(`private connection survives deferred work and closes after observation (failure=${failedWork}, observation failure=${observationFails})`, async () => {
      const directory = mkdtempSync(join(tmpdir(), 'study-scope-'))
      const libraries = new PrivateLibraries(directory)
      let personal: LibraryRepository | undefined
      let resume!: () => void
      const deferred = new Promise<void>((resolve) => {
        resume = resolve
      })
      let observed = false
      let close: ReturnType<typeof mock.method> | undefined
      const scope = new StudyLibraryScope(libraries, {
        observeRequest(method, accountId, connection) {
          assert.equal(method, 'POST')
          assert.equal(accountId, actor.id)
          assert.equal(connection, personal)
          connection.quizStore().nextHousekeepingAt()
          observed = true
          if (observationFails) {
            throw new Error('observation failed')
          }
        },
      })
      try {
        const pending = scope.withLibrary(actor, 'POST', async (connection) => {
          personal = connection
          close = mock.method(connection, 'close')
          await deferred
          connection.quizStore().nextHousekeepingAt()
          if (failedWork) {
            throw new Error('work failed')
          }
          return 'done'
        })
        assert.ok(personal)
        assert.equal(observed, false)
        personal.quizStore().nextHousekeepingAt()
        resume()
        if (observationFails || failedWork) {
          await assert.rejects(pending, observationFails ? /observation failed/ : /work failed/)
        } else {
          assert.equal(await pending, 'done')
        }
        assert.equal(observed, true)
        assert.equal(close!.mock.callCount(), 1)
        assert.throws(() => personal!.quizStore().nextHousekeepingAt(), /closed|not open/)
      } finally {
        rmSync(directory, { recursive: true, force: true })
      }
    })
  }
}
