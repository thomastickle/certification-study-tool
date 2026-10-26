import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { LibraryRepository } from '../src/server/questions/library-repository.ts'
import { PrivateLibraries } from '../src/server/questions/private-libraries.ts'
import { StudyLibrary } from '../src/server/questions/study-library.ts'
import { expireStudyWork } from '../src/server/questions/study-housekeeping.ts'
import { QuizService } from '../src/server/quizzes/quiz-service.ts'

for (const failure of ['reconciliation', 'expiry', 'close'] as const) {
  test(`housekeeping closes connections, continues and retries after a ${failure} failure`, (t) => {
    const directory = mkdtempSync(join(tmpdir(), 'study-upkeep-'))
    const shared = new LibraryRepository(join(directory, 'library.sqlite3'))
    const libraries = new PrivateLibraries(join(directory, 'users'))
    const ids = [randomUUID(), randomUUID()]
    for (const id of ids) {
      libraries.open(id).close()
    }
    const ordered = libraries.accounts()
    const opened: string[] = []
    const closed: string[] = []
    const logged: unknown[][] = []
    t.mock.method(console, 'error', (...args: unknown[]) => logged.push(args))
    const open = libraries.open.bind(libraries)
    let closeFailed = false
    t.mock.method(libraries, 'open', (id: string) => {
      opened.push(id)
      const personal = open(id)
      const close = personal.close.bind(personal)
      t.mock.method(personal, 'close', () => {
        close()
        closed.push(id)
        if (failure === 'close' && !closeFailed) {
          closeFailed = true
          throw new Error('Sensitive private storage path')
        }
      })
      return personal
    })
    // Faults occur after a connection is returned, so its finally-owned cleanup is exercised.
    let workFailed = false

    const failOnce = () => {
      if (!workFailed) {
        workFailed = true
        throw new Error('Sensitive private snapshot')
      }
    }

    if (failure === 'reconciliation') {
      t.mock.method(StudyLibrary.prototype, 'synchronizeDeletions', failOnce)
    } else if (failure === 'expiry') {
      t.mock.method(QuizService.prototype, 'expireDue', failOnce)
    }
    try {
      expireStudyWork(shared, libraries)
      assert.deepEqual(opened, ordered)
      assert.deepEqual(closed, ordered)
      assert.equal(logged.length, 1)
      assert.deepEqual(logged[0], [
        `Private study upkeep failed for ${ordered[0]}; it will be retried.`,
      ])
      expireStudyWork(shared, libraries)
      assert.deepEqual(opened, [...ordered, ...ordered])
      assert.deepEqual(closed, [...ordered, ...ordered])
      assert.equal(logged.length, 1, 'A successful retry does not repeat the error')
    } finally {
      shared.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })
}

test('routine directory discovery failure is sanitized and does not abort startup', (t) => {
  const shared = new LibraryRepository(':memory:')
  const libraries = new PrivateLibraries('/unused-synthetic-directory')
  const logged: unknown[][] = []
  t.mock.method(console, 'error', (...args: unknown[]) => logged.push(args))
  t.mock.method(libraries, 'accounts', () => {
    throw new Error('Sensitive private directory')
  })
  try {
    assert.doesNotThrow(() => expireStudyWork(shared, libraries))
    assert.deepEqual(logged, [
      ['Could not discover private libraries for housekeeping; it will be retried.'],
    ])
  } finally {
    shared.close()
  }
})
