import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { LibraryRepository } from '../src/server/questions/library-repository.ts'
import { PrivateLibraries } from '../src/server/questions/private-libraries.ts'
import { StudyLibrary } from '../src/server/questions/study-library.ts'
import { expireStudyWork, StudyHousekeeping } from '../src/server/questions/study-housekeeping.ts'
import { QuizService } from '../src/server/quizzes/quiz-service.ts'
import { populate } from './quiz-fixtures.ts'
import { LibraryService } from '../src/server/questions/library-service.ts'

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

test('scheduler skips idle opens between reconciliation passes and scores observed deadlines', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'study-scheduled-'))
  const shared = new LibraryRepository(':memory:')
  const libraries = new PrivateLibraries(directory)
  const id = randomUUID()
  const personal = libraries.open(id)
  let time = 1_000_000
  let monotonic = 0
  const housekeeping = new StudyHousekeeping(
    shared,
    libraries,
    () => monotonic,
    () => time,
  )
  const open = t.mock.method(libraries, 'open')
  try {
    housekeeping.tick()
    monotonic = 1000
    time += 1000
    housekeeping.tick()
    assert.equal(open.mock.callCount(), 1, 'Idle ticks must not open or verify private files')
    populate(personal)
    const study = shared.forAccount(id, personal)
    const quizzes = new QuizService(study, () => time)
    const active = quizzes.start({ sourceFilter: 'mixed', questionType: 'mixed' })
    const stored = personal.quizStore().find(active.id)!
    stored.deadline = time + 1000
    personal.quizStore().save(stored)
    housekeeping.observe(id, personal)
    monotonic = 2000
    time += 1000
    housekeeping.tick()
    assert.equal(personal.quizStore().find(active.id)!.status, 'completed')
    assert.equal(open.mock.callCount(), 2, 'A due owner is opened without rescanning idle owners')
    const paused = quizzes.start({ sourceFilter: 'mixed', questionType: 'mixed' })
    quizzes.pause(paused.id)
    housekeeping.observe(id, personal)
    monotonic = 3000
    time += 30 * 60_000
    housekeeping.tick()
    assert.equal(personal.quizStore().find(paused.id)!.status, 'paused')
    assert.equal(open.mock.callCount(), 2)
    monotonic = 5000
    housekeeping.tick()
    assert.equal(open.mock.callCount(), 3, 'Reconciliation uses monotonic elapsed time')
  } finally {
    personal.close()
    shared.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('scheduler reconstructs expiry, retention and shared deletions after downtime', () => {
  const directory = mkdtempSync(join(tmpdir(), 'study-recovery-'))
  const shared = new LibraryRepository(':memory:')
  const libraries = new PrivateLibraries(directory)
  const id = randomUUID()
  const personal = libraries.open(id)
  const epoch = 1_000_000
  let time = epoch
  let monotonic = 0
  try {
    populate(shared)
    const study = shared.forAccount(id, personal)
    const quizzes = new QuizService(study, () => time)
    const pending = quizzes.start({ sourceFilter: 'mixed', questionType: 'mixed' })
    const retained = structuredClone(personal.quizStore().find(pending.id)!)
    retained.id = randomUUID()
    retained.status = 'deleted'
    retained.deletedAt = time - 48 * 60 * 60_000
    retained.purgeAt = time + 2000
    personal.quizStore().save(retained)
    const paused = structuredClone(personal.quizStore().find(pending.id)!)
    paused.id = randomUUID()
    paused.status = 'paused'
    paused.pausedAt = time
    personal.quizStore().save(paused)
    // Reconstruct using persisted state, without a foreground observe call.
    let scheduler = new StudyHousekeeping(
      shared,
      libraries,
      () => monotonic,
      () => time,
    )
    scheduler.tick()
    time += 2000
    monotonic += 2000
    scheduler.tick()
    assert.equal(
      personal.quizStore().find(retained.id),
      undefined,
      'Purge runs at its known deadline',
    )
    new LibraryService(shared).deleteSource(shared.sources()[0]!.id)
    time += 48 * 60 * 60_000
    scheduler = new StudyHousekeeping(
      shared,
      libraries,
      () => monotonic,
      () => time,
    )
    scheduler.tick()
    assert.equal(personal.quizStore().find(pending.id)!.status, 'completed')
    assert.equal(personal.quizStore().find(paused.id)!.status, 'paused')
    assert.deepEqual(personal.quizStore().find(pending.id)!.deletedBankNames, ['quiz-synthetic'])
    assert.equal(personal.sharedDeletionCursor(), 1)
    // A new file created outside this process is discovered by the periodic recovery pass.
    const newcomerId = randomUUID()
    const newcomer = libraries.open(newcomerId)
    try {
      const overdue = { ...structuredClone(paused), id: randomUUID(), status: 'active' as const }
      newcomer.quizStore().save(overdue)
      monotonic += 5000
      scheduler.tick()
      assert.equal(newcomer.quizStore().find(overdue.id)!.status, 'completed')
      assert.equal(newcomer.sharedDeletionCursor(), 1)
    } finally {
      newcomer.close()
    }
  } finally {
    personal.close()
    shared.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('failed discovery does not block a known due owner and retries on the next reconciliation', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'study-discovery-retry-'))
  const shared = new LibraryRepository(':memory:')
  const libraries = new PrivateLibraries(directory)
  const id = randomUUID()
  const personal = libraries.open(id)
  let time = 1_000_000
  let monotonic = 0
  const scheduler = new StudyHousekeeping(
    shared,
    libraries,
    () => monotonic,
    () => time,
  )
  t.mock.method(console, 'error', () => {})
  try {
    populate(personal)
    const study = shared.forAccount(id, personal)
    const quizzes = new QuizService(study, () => time)
    const quiz = quizzes.start({ sourceFilter: 'mixed', questionType: 'mixed' })
    scheduler.tick()
    const discover = t.mock.method(libraries, 'accounts', () => {
      throw new Error('Sensitive directory')
    })
    time += 30 * 60_000
    monotonic += 5000
    scheduler.tick()
    assert.equal(personal.quizStore().find(quiz.id)!.status, 'completed')
    assert.equal(discover.mock.callCount(), 1)
    monotonic += 1000
    scheduler.tick()
    assert.equal(discover.mock.callCount(), 1)
    discover.mock.restore()
    monotonic += 4000
    assert.doesNotThrow(() => scheduler.tick())
  } finally {
    personal.close()
    shared.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('foreground resume, deletion and restore refresh or cancel background deadlines', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'study-foreground-deadlines-'))
  const shared = new LibraryRepository(':memory:')
  const libraries = new PrivateLibraries(directory)
  const id = randomUUID()
  const personal = libraries.open(id)
  let time = 1_000_000
  let monotonic = 0
  const scheduler = new StudyHousekeeping(
    shared,
    libraries,
    () => monotonic,
    () => time,
  )
  const opened = t.mock.method(libraries, 'open')
  try {
    populate(personal)
    const quizzes = new QuizService(shared.forAccount(id, personal), () => time)
    const quiz = quizzes.start({ sourceFilter: 'mixed', questionType: 'mixed' })
    const stored = personal.quizStore().find(quiz.id)!
    stored.deadline = time + 1000
    personal.quizStore().save(stored)
    quizzes.pause(quiz.id)
    scheduler.tick()
    time += 1000
    monotonic += 1000
    quizzes.resume(quiz.id)
    scheduler.observe(id, personal)
    time += 1000
    monotonic += 1000
    scheduler.tick()
    assert.equal(personal.quizStore().find(quiz.id)!.status, 'completed')
    assert.equal(opened.mock.callCount(), 2)
    quizzes.deleteResult(quiz.id)
    scheduler.observe(id, personal)
    quizzes.restoreResult(quiz.id)
    scheduler.observe(id, personal)
    time += 48 * 60 * 60_000
    monotonic += 1000
    scheduler.tick()
    assert.equal(personal.quizStore().find(quiz.id)!.status, 'completed')
    assert.equal(opened.mock.callCount(), 2, 'Restoring cancels the retained-deletion deadline')
    quizzes.deleteResult(quiz.id)
    scheduler.observe(id, personal)
    time += 48 * 60 * 60_000
    monotonic += 1000
    scheduler.tick()
    assert.equal(personal.quizStore().find(quiz.id), undefined)
    assert.equal(opened.mock.callCount(), 3, 'Foreground deletion schedules its purge')
  } finally {
    personal.close()
    shared.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
