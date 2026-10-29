import { preparePersonalFixtures } from './managed-database-fixture.ts'
import { prepareRuntimeDatabase } from './managed-database-fixture.ts'
import { prepareManagedDatabase } from './managed-database-fixture.ts'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { setImmediate as yieldTurn } from 'node:timers/promises'
import { LibraryRepository } from '../src/server/questions/library-repository.ts'
import { PrivateLibraries } from '../src/server/questions/private-libraries.ts'
import { StudyLibrary } from '../src/server/questions/study-library.ts'
import { StudyHousekeeping } from '../src/server/questions/study-housekeeping.ts'
import { QuizService } from '../src/server/quizzes/quiz-service.ts'
import { populate } from './quiz-fixtures.ts'
import { LibraryService } from '../src/server/questions/library-service.ts'

for (const failure of ['reconciliation', 'expiry', 'close'] as const) {
  test(`housekeeping closes connections, continues and retries after a ${failure} failure`, async (t) => {
    const directory = mkdtempSync(join(tmpdir(), 'study-upkeep-'))
    prepareRuntimeDatabase(join(directory, 'library.sqlite3'))
    const shared = new LibraryRepository(join(directory, 'library.sqlite3'))
    const libraries = new PrivateLibraries(join(directory, 'users'))
    const ids = [randomUUID(), randomUUID()]
    preparePersonalFixtures(join(directory, 'users'), ids, directory)
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
    let monotonic = 0
    const scheduler = new StudyHousekeeping(shared, libraries, () => monotonic)
    try {
      await scheduler.tick()
      assert.deepEqual(opened, ordered)
      assert.deepEqual(closed, ordered)
      assert.equal(logged.length, 1)
      assert.deepEqual(logged[0], [
        `Private study upkeep failed for ${ordered[0]}; it will be retried.`,
      ])
      await scheduler.tick()
      assert.deepEqual(opened, [...ordered, ordered[0]])
      assert.deepEqual(closed, [...ordered, ordered[0]])
      assert.equal(logged.length, 1, 'A successful retry does not repeat the error')
      // Exercise the retained runtime, then preserve the original full-pass recovery assertions.
      monotonic = 5000
      await scheduler.tick()
      assert.deepEqual(opened, [...ordered, ordered[0], ...ordered])
      assert.deepEqual(closed, [...ordered, ordered[0], ...ordered])
      assert.equal(logged.length, 1)
    } finally {
      shared.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })
}

test('routine directory discovery failure is sanitized and does not abort startup', async (t) => {
  const shared = new LibraryRepository(prepareManagedDatabase())
  const libraries = new PrivateLibraries('/unused-synthetic-directory')
  const logged: unknown[][] = []
  t.mock.method(console, 'error', (...args: unknown[]) => logged.push(args))
  t.mock.method(libraries, 'accounts', () => {
    throw new Error('Sensitive private directory')
  })
  try {
    await new StudyHousekeeping(shared, libraries).tick()
    assert.deepEqual(logged, [
      ['Could not discover private libraries for housekeeping; it will be retried.'],
    ])
  } finally {
    shared.close()
  }
})

test('scheduler skips idle opens between reconciliation passes and scores observed deadlines', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'study-scheduled-'))
  const shared = new LibraryRepository(prepareManagedDatabase())
  const libraries = new PrivateLibraries(directory, directory)
  const id = randomUUID()
  preparePersonalFixtures(directory, [id])
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
    await housekeeping.tick()
    monotonic = 1000
    time += 1000
    await housekeeping.tick()
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
    await housekeeping.tick()
    assert.equal(personal.quizStore().find(active.id)!.status, 'completed')
    assert.equal(open.mock.callCount(), 2, 'A due owner is opened without rescanning idle owners')
    const paused = quizzes.start({ sourceFilter: 'mixed', questionType: 'mixed' })
    quizzes.pause(paused.id)
    housekeeping.observe(id, personal)
    monotonic = 3000
    time += 30 * 60_000
    await housekeeping.tick()
    assert.equal(personal.quizStore().find(paused.id)!.status, 'paused')
    assert.equal(open.mock.callCount(), 2)
    monotonic = 5000
    await housekeeping.tick()
    assert.equal(open.mock.callCount(), 3, 'Reconciliation uses monotonic elapsed time')
  } finally {
    personal.close()
    shared.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('scheduler reconstructs expiry, retention and shared deletions after downtime', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'study-recovery-'))
  const shared = new LibraryRepository(prepareManagedDatabase())
  const libraries = new PrivateLibraries(directory, directory)
  const id = randomUUID()
  preparePersonalFixtures(directory, [id])
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
    await scheduler.tick()
    time += 2000
    monotonic += 2000
    await scheduler.tick()
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
    await scheduler.tick()
    assert.equal(personal.quizStore().find(pending.id)!.status, 'completed')
    assert.equal(personal.quizStore().find(paused.id)!.status, 'paused')
    assert.deepEqual(personal.quizStore().find(pending.id)!.deletedBankNames, ['quiz-synthetic'])
    assert.equal(personal.sharedDeletionCursor(), 1)
    // A new file created outside this process is discovered by the periodic recovery pass.
    const newcomerId = randomUUID()
    preparePersonalFixtures(directory, [newcomerId])
    const newcomer = libraries.open(newcomerId)
    try {
      const overdue = { ...structuredClone(paused), id: randomUUID(), status: 'active' as const }
      newcomer.quizStore().save(overdue)
      monotonic += 5000
      await scheduler.tick()
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

test('failed discovery does not block a known due owner and retries on the next reconciliation', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'study-discovery-retry-'))
  const shared = new LibraryRepository(prepareManagedDatabase())
  const libraries = new PrivateLibraries(directory, directory)
  const id = randomUUID()
  preparePersonalFixtures(directory, [id])
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
    await scheduler.tick()
    const discover = t.mock.method(libraries, 'accounts', () => {
      throw new Error('Sensitive directory')
    })
    time += 30 * 60_000
    monotonic += 5000
    await scheduler.tick()
    assert.equal(personal.quizStore().find(quiz.id)!.status, 'completed')
    assert.equal(discover.mock.callCount(), 1)
    monotonic += 1000
    await scheduler.tick()
    assert.equal(discover.mock.callCount(), 1)
    discover.mock.restore()
    monotonic += 4000
    await scheduler.tick()
  } finally {
    personal.close()
    shared.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('foreground resume, deletion and restore refresh or cancel background deadlines', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'study-foreground-deadlines-'))
  const shared = new LibraryRepository(prepareManagedDatabase())
  const libraries = new PrivateLibraries(directory, directory)
  const id = randomUUID()
  preparePersonalFixtures(directory, [id])
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
    await scheduler.tick()
    time += 1000
    monotonic += 1000
    quizzes.resume(quiz.id)
    scheduler.observe(id, personal)
    time += 1000
    monotonic += 1000
    await scheduler.tick()
    assert.equal(personal.quizStore().find(quiz.id)!.status, 'completed')
    assert.equal(opened.mock.callCount(), 2)
    quizzes.deleteResult(quiz.id)
    scheduler.observe(id, personal)
    quizzes.restoreResult(quiz.id)
    scheduler.observe(id, personal)
    time += 48 * 60 * 60_000
    monotonic += 1000
    await scheduler.tick()
    assert.equal(personal.quizStore().find(quiz.id)!.status, 'completed')
    assert.equal(opened.mock.callCount(), 2, 'Restoring cancels the retained-deletion deadline')
    quizzes.deleteResult(quiz.id)
    scheduler.observe(id, personal)
    time += 48 * 60 * 60_000
    monotonic += 1000
    await scheduler.tick()
    assert.equal(personal.quizStore().find(quiz.id), undefined)
    assert.equal(opened.mock.callCount(), 3, 'Foreground deletion schedules its purge')
  } finally {
    personal.close()
    shared.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('owner batches yield closed connections, prioritize new deadlines and coalesce ticks', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'study-batches-'))
  const shared = new LibraryRepository(prepareManagedDatabase())
  const libraries = new PrivateLibraries(directory, directory)
  const ids = Array.from({ length: 6 }, () => randomUUID())
  preparePersonalFixtures(directory, ids)
  for (const id of ids) {
    libraries.open(id).close()
  }
  t.mock.method(libraries, 'accounts', () => ids)
  let time = 1_000_000
  const scheduler = new StudyHousekeeping(
    shared,
    libraries,
    () => 0,
    () => time,
  )
  const opened: string[] = []
  let connections = 0
  const open = libraries.open.bind(libraries)
  t.mock.method(libraries, 'open', (id: string) => {
    opened.push(id)
    const personal = open(id)
    connections++
    const close = personal.close.bind(personal)
    t.mock.method(personal, 'close', () => {
      close()
      connections--
    })
    return personal
  })
  try {
    const pass = scheduler.tick()
    assert.ok(opened.length < ids.length, 'A full sweep must not occupy one event-loop turn')
    assert.equal(connections, 0, 'Close before yielding to foreground work')
    const urgentId = ids.at(-1)!
    const personal = open(urgentId)
    let attemptId: string
    try {
      populate(personal)
      const quiz = new QuizService(shared.forAccount(urgentId, personal), () => time)
      attemptId = quiz.start({ sourceFilter: 'mixed', questionType: 'mixed' }).id
      scheduler.observe(urgentId, personal)
    } finally {
      personal.close()
    }
    time += 30 * 60_000
    assert.equal(scheduler.tick(), pass, 'Overlapping ticks share one drain promise')
    assert.equal(scheduler.tick(), pass, 'Repeated ticks coalesce instead of queueing sweeps')
    await yieldTurn()
    assert.equal(opened[1], urgentId, 'A newly due owner jumps ahead of the idle sweep')
    assert.equal(connections, 0)
    await pass
    assert.equal(opened.length, ids.length, 'Coalescing does not repeat the discovery sweep')
    assert.equal(new Set(opened).size, ids.length)
    const check = open(urgentId)
    try {
      assert.equal(check.quizStore().find(attemptId)!.status, 'completed')
    } finally {
      check.close()
    }
  } finally {
    await scheduler.stop()
    shared.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

for (const initiallyDue of [false, true]) {
  test(`a visited owner's future deadline interrupts the idle sweep (initially due: ${initiallyDue})`, async (t) => {
    const directory = mkdtempSync(join(tmpdir(), 'study-due-after-visit-'))
    const shared = new LibraryRepository(prepareManagedDatabase())
    const libraries = new PrivateLibraries(directory, directory)
    const ids = Array.from({ length: 4 }, () => randomUUID())
    preparePersonalFixtures(directory, ids)
    let time = 1_000_000
    const scheduler = new StudyHousekeeping(
      shared,
      libraries,
      () => 0,
      () => time,
    )
    const open = libraries.open.bind(libraries)
    const opened: string[] = []
    const closed: string[] = []
    try {
      for (const id of ids) {
        open(id).close()
      }
      const firstId = ids[0]!
      const personal = open(firstId)
      let pendingId: string
      let dueId: string | undefined
      try {
        populate(personal)
        const quizzes = new QuizService(shared.forAccount(firstId, personal), () => time)
        pendingId = quizzes.start({ sourceFilter: 'mixed', questionType: 'mixed' }).id
        const pending = personal.quizStore().find(pendingId)!
        pending.deadline = time + 1000
        personal.quizStore().save(pending)
        if (initiallyDue) {
          dueId = randomUUID()
          personal.quizStore().save({ ...structuredClone(pending), id: dueId, deadline: time - 1 })
        }
        scheduler.observe(firstId, personal)
      } finally {
        personal.close()
      }
      t.mock.method(libraries, 'accounts', () => ids)
      t.mock.method(libraries, 'open', (id: string) => {
        opened.push(id)
        const personal = open(id)
        const close = personal.close.bind(personal)
        t.mock.method(personal, 'close', () => {
          close()
          closed.push(id)
        })
        return personal
      })
      const pass = scheduler.tick()
      assert.deepEqual(opened, [firstId])
      assert.deepEqual(closed, opened, 'The first visit closes before the deadline arrives')
      time += 1000
      assert.equal(scheduler.tick(), pass, 'An overlapping tick coalesces with the sweep')
      await yieldTurn()
      assert.equal(opened[1], firstId, 'Newly due work precedes every remaining idle owner')
      assert.deepEqual(closed, opened, 'The priority visit also closes before yielding')
      const check = open(firstId)
      try {
        assert.equal(check.quizStore().find(pendingId)!.status, 'completed')
        if (dueId !== undefined) {
          assert.equal(check.quizStore().find(dueId)!.status, 'completed')
        }
      } finally {
        check.close()
      }
      await pass
      assert.deepEqual(opened, [firstId, ...ids])
      assert.deepEqual(closed, opened)
    } finally {
      await scheduler.stop()
      shared.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })
}

for (const metadata of ['failure', 'stale'] as const) {
  test(`${metadata} deadline metadata cannot spin or starve the remaining owners`, async (t) => {
    const directory = mkdtempSync(join(tmpdir(), 'study-unproductive-deadline-'))
    const shared = new LibraryRepository(prepareManagedDatabase())
    const libraries = new PrivateLibraries(directory, directory)
    const ids = Array.from({ length: 4 }, () => randomUUID())
    preparePersonalFixtures(directory, ids)
    const time = 1_000_000
    const scheduler = new StudyHousekeeping(
      shared,
      libraries,
      () => 0,
      () => time,
    )
    const open = libraries.open.bind(libraries)
    const opened: string[] = []
    const closed: string[] = []
    t.mock.method(console, 'error', () => {})
    try {
      for (const id of ids) {
        open(id).close()
      }
      t.mock.method(libraries, 'accounts', () => ids)
      t.mock.method(libraries, 'open', (id: string) => {
        opened.push(id)
        const personal = open(id)
        if (id === ids[0]) {
          const store = personal.quizStore()
          t.mock.method(personal, 'quizStore', () => store)
          t.mock.method(store, 'nextHousekeepingAt', () => {
            if (metadata === 'failure') {
              throw new Error('Synthetic metadata failure')
            }
            return time - 1
          })
        }
        const close = personal.close.bind(personal)
        t.mock.method(personal, 'close', () => {
          close()
          closed.push(id)
        })
        return personal
      })
      const pass = scheduler.tick()
      // Bound the probe so a spinning implementation fails instead of hanging the test runner.
      for (let slice = 0; slice < ids.length + 1; slice++) {
        await yieldTurn()
      }
      assert.deepEqual(opened, ids, 'Unproductive due work must let the idle sweep finish')
      assert.deepEqual(closed, opened)
      await pass
      await scheduler.tick()
      assert.deepEqual(opened, [...ids, ids[0]], 'Suppression ends on the next tick')
      assert.deepEqual(closed, opened)
    } finally {
      await scheduler.stop()
      shared.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })
}

test('stop cancels a yielded sweep and drains before the root repository closes', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'study-stop-'))
  const shared = new LibraryRepository(prepareManagedDatabase())
  const libraries = new PrivateLibraries(directory, directory)
  for (let index = 0; index < 4; index++) {
    const owner = randomUUID()
    preparePersonalFixtures(directory, [owner])
    libraries.open(owner).close()
  }
  const opened = t.mock.method(libraries, 'open')
  const scheduler = new StudyHousekeeping(shared, libraries)
  try {
    const pass = scheduler.tick()
    await scheduler.stop()
    await pass
    assert.equal(opened.mock.callCount(), 1, 'Cancellation must skip the remaining owners')
    shared.close()
    await scheduler.tick()
    await yieldTurn()
    assert.equal(opened.mock.callCount(), 1, 'Stopped ticks never access the closed root')
  } finally {
    await scheduler.stop()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('simultaneously due owners also yield and accept a newer deadline for a visited owner', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'study-due-batches-'))
  const shared = new LibraryRepository(prepareManagedDatabase())
  const libraries = new PrivateLibraries(directory, directory)
  const ids = Array.from({ length: 4 }, () => randomUUID())
  preparePersonalFixtures(directory, ids)
  let time = 1_000_000
  const scheduler = new StudyHousekeeping(
    shared,
    libraries,
    () => 0,
    () => time,
  )
  const attempts = new Map<string, string>()
  try {
    for (const id of ids) {
      const personal = libraries.open(id)
      try {
        populate(personal)
        const quizzes = new QuizService(shared.forAccount(id, personal), () => time)
        attempts.set(id, quizzes.start({ sourceFilter: 'mixed', questionType: 'mixed' }).id)
      } finally {
        personal.close()
      }
    }
    await scheduler.tick()
    const opened = t.mock.method(libraries, 'open')
    time += 30 * 60_000
    const pass = scheduler.tick()
    assert.equal(opened.mock.callCount(), 1, 'Due cohorts must yield just like discovery sweeps')
    const firstId = opened.mock.calls[0]!.arguments[0]
    const personal = new PrivateLibraries(directory, directory).open(firstId)
    let newer: string
    try {
      const quizzes = new QuizService(shared.forAccount(firstId, personal), () => time)
      newer = quizzes.start({ sourceFilter: 'mixed', questionType: 'mixed' }).id
      scheduler.observe(firstId, personal)
    } finally {
      personal.close()
    }
    time += 30 * 60_000
    await pass
    assert.equal(opened.mock.callCount(), ids.length + 1)
    for (const id of ids) {
      const check = libraries.open(id)
      try {
        assert.equal(check.quizStore().find(attempts.get(id)!)!.status, 'completed')
        if (id === firstId) {
          assert.equal(check.quizStore().find(newer)!.status, 'completed')
        }
      } finally {
        check.close()
      }
    }
  } finally {
    await scheduler.stop()
    shared.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('request observation skips read metadata but refreshes attempted mutations and retries failed reads', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'study-request-observation-'))
  const shared = new LibraryRepository(prepareManagedDatabase())
  const libraries = new PrivateLibraries(directory, directory)
  const id = randomUUID()
  preparePersonalFixtures(directory, [id])
  const personal = libraries.open(id)
  let time = 1_000_000
  const scheduler = new StudyHousekeeping(
    shared,
    libraries,
    () => 0,
    () => time,
  )
  t.mock.method(console, 'error', () => {})
  try {
    await scheduler.tick()
    populate(personal)
    const quizzes = new QuizService(shared.forAccount(id, personal), () => time)
    const attempt = quizzes.start({ sourceFilter: 'mixed', questionType: 'mixed' })
    const store = personal.quizStore()
    t.mock.method(personal, 'quizStore', () => store)
    const metadata = t.mock.method(store, 'nextHousekeepingAt')
    for (const method of ['GET', 'HEAD']) {
      scheduler.observeRequest(method, id, personal)
    }
    assert.equal(metadata.mock.callCount(), 0, 'Bank browsing must not scan deadline JSON')
    scheduler.observeRequest('POST', id, personal)
    assert.equal(metadata.mock.callCount(), 1)
    const opened = t.mock.method(libraries, 'open')
    quizzes.pause(attempt.id)
    scheduler.observeRequest('POST', id, personal)
    time += 30 * 60_000
    await scheduler.tick()
    assert.equal(opened.mock.callCount(), 0, 'Pause cancels the observed deadline')
    quizzes.resume(attempt.id)
    metadata.mock.mockImplementation(() => {
      throw new Error('Synthetic private metadata')
    })
    assert.doesNotThrow(() => scheduler.observeRequest('POST', id, personal))
    time += 30 * 60_000
    await scheduler.tick()
    assert.equal(personal.quizStore().find(attempt.id)!.status, 'completed')
    assert.equal(opened.mock.callCount(), 1, 'Failed mutation metadata is retried on the next tick')
    metadata.mock.restore()
    const abandoned = quizzes.start({ sourceFilter: 'mixed', questionType: 'mixed' })
    scheduler.observeRequest('POST', id, personal)
    quizzes.abandon(abandoned.id)
    scheduler.observeRequest('POST', id, personal)
    time += 30 * 60_000
    await scheduler.tick()
    assert.equal(opened.mock.callCount(), 1, 'Abandon cancels background work')
  } finally {
    await scheduler.stop()
    personal.close()
    shared.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
