import { prepareRuntimeDatabase, preparePersonalFixtures } from './managed-database-fixture.ts'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { setTimeout as delay } from 'node:timers/promises'
import { LibraryRepository } from '../src/server/questions/library-repository.ts'
import { PrivateLibraries } from '../src/server/questions/private-libraries.ts'
import { StudyHousekeeping } from '../src/server/questions/study-housekeeping.ts'
import { LibraryService } from '../src/server/questions/library-service.ts'
import { QuizService } from '../src/server/quizzes/quiz-service.ts'
import { populate } from './quiz-fixtures.ts'

// Synthetic files only. Redirect output to a restricted file outside the repository.
for (const population of [10, 100]) {
  const directory = mkdtempSync(join(tmpdir(), 'housekeeping-benchmark-'))
  prepareRuntimeDatabase(join(directory, 'shared.sqlite3'))
  const shared = new LibraryRepository(join(directory, 'shared.sqlite3'))
  const libraries = new PrivateLibraries(join(directory, 'users'))
  const epoch = Date.now()
  try {
    populate(shared)
    const templateView = new QuizService(shared, () => epoch).start({
      sourceFilter: 'mixed',
      questionType: 'mixed',
    })
    const template = shared.quizStore().find(templateView.id)!
    shared.quizStore().remove(template.id)
    for (let owner = 0; owner < population; owner++) {
      const id = randomUUID()
      preparePersonalFixtures(join(directory, 'users'), [id], directory)
      const personal = libraries.open(id)
      try {
        for (let index = 0; index < 10; index++) {
          personal.quizStore().save({
            ...structuredClone(template),
            id: randomUUID(),
            status: 'completed',
            finishedAt: epoch,
            correctCount: 0,
          })
        }
        if (owner % 5 === 0) {
          personal.quizStore().save({
            ...structuredClone(template),
            id: randomUUID(),
            deadline: epoch + 3000,
          })
        }
        if (owner % 5 === 1) {
          personal.quizStore().save({
            ...structuredClone(template),
            id: randomUUID(),
            status: 'deleted',
            deletedAt: epoch - 48 * 60 * 60_000,
            purgeAt: epoch + 4000,
          })
        }
      } finally {
        personal.close()
      }
    }
    new LibraryService(shared).deleteSource(shared.sources()[0]!.id)
    let tick = 0
    const scheduler = new StudyHousekeeping(
      shared,
      libraries,
      () => tick * 1000,
      () => epoch + tick * 1000,
    )
    const mode = process.argv[2] ?? 'scheduled'
    if (!['baseline', 'scheduled'].includes(mode)) {
      throw new Error('Expected baseline or scheduled')
    }
    let opens = 0
    let connections = 0
    let peakConnections = 0
    let discoveries = 0
    let ownerBlockingMs = 0
    let discoveryBlockingMs = 0
    let maxOwnerBlockingMs = 0
    const open = libraries.open.bind(libraries)
    const accounts = libraries.accounts.bind(libraries)
    libraries.open = (id) => {
      opens++
      const started = performance.now()
      const personal = open(id)
      connections++
      peakConnections = Math.max(peakConnections, connections)
      const close = personal.close.bind(personal)
      personal.close = () => {
        try {
          close()
        } finally {
          connections--
          const elapsed = performance.now() - started
          ownerBlockingMs += elapsed
          maxOwnerBlockingMs = Math.max(maxOwnerBlockingMs, elapsed)
        }
      }
      return personal
    }
    libraries.accounts = () => {
      discoveries++
      const started = performance.now()
      try {
        return accounts()
      } finally {
        discoveryBlockingMs += performance.now() - started
      }
    }
    const passes: {
      elapsedMs: number
      operationBlockingMs: number
      maxOwnerBlockingMs: number
      maxTimerDelayMs: number
      timerSamples: number
    }[] = []
    for (tick = 0; tick < 20; tick++) {
      const priorBlockingMs = ownerBlockingMs + discoveryBlockingMs
      maxOwnerBlockingMs = 0
      let maxTimerDelayMs = 0
      let timerSamples = 0
      let previousTimer = performance.now()
      // Keep probing THROUGH the final batch; one timer scheduled before tick misses later stalls.
      const timer = setInterval(() => {
        const now = performance.now()
        maxTimerDelayMs = Math.max(maxTimerDelayMs, now - previousTimer)
        previousTimer = now
        timerSamples++
      }, 1)
      const start = performance.now()
      const realNow = Date.now
      let elapsedMs: number
      try {
        Date.now = () => epoch + tick * 1000
        if (mode === 'baseline') {
          baselinePass(shared, libraries)
        } else {
          await scheduler.tick()
        }
        elapsedMs = performance.now() - start
        // Include the last synchronous slice in timer latency, excluding this drain from pass elapsed.
        await delay(0)
      } finally {
        Date.now = realNow
        clearInterval(timer)
      }
      passes.push({
        elapsedMs,
        operationBlockingMs: ownerBlockingMs + discoveryBlockingMs - priorBlockingMs,
        maxOwnerBlockingMs,
        maxTimerDelayMs,
        timerSamples,
      })
    }
    await scheduler.stop()
    assert.equal(connections, 0)
    assert.equal(peakConnections, 1)
    assert.equal(
      opens,
      mode === 'baseline' ? population * 20 : population * 4 + (population / 5) * 2,
    )
    assert.equal(discoveries, mode === 'baseline' ? 20 : 4)
    // Validate equal useful work without counting these verification connections as upkeep.
    let completed = 0
    for (const id of accounts()) {
      const personal = open(id)
      try {
        assert.equal(personal.sharedDeletionCursor(), 1)
        assert.equal(personal.quizStore().active().length, 0)
        assert.equal(personal.quizStore().deleted().length, 0)
        const histories = personal.quizStore().completed()
        for (const history of histories) {
          assert.deepEqual(history.deletedBankNames, ['quiz-synthetic'])
        }
        completed += histories.length
      } finally {
        personal.close()
      }
    }
    assert.equal(completed, population * 10 + population / 5)
    console.log(
      JSON.stringify({
        mode,
        population,
        peakConnections,
        remainingConnections: connections,
        ticks: 20,
        opens,
        discoveries,
        startupElapsedMs: passes[0]!.elapsedMs,
        startupOperationBlockingMs: passes[0]!.operationBlockingMs,
        startupMaxTimerDelayMs: passes[0]!.maxTimerDelayMs,
        recurringElapsedMs: passes.slice(1).reduce((sum, pass) => sum + pass.elapsedMs, 0),
        recurringOperationBlockingMs: passes
          .slice(1)
          .reduce((sum, pass) => sum + pass.operationBlockingMs, 0),
        recurringMaxOwnerBlockingMs: Math.max(
          ...passes.slice(1).map((pass) => pass.maxOwnerBlockingMs),
        ),
        recurringMaxTimerDelayMs: Math.max(...passes.slice(1).map((pass) => pass.maxTimerDelayMs)),
        timerSamples: passes.reduce((sum, pass) => sum + pass.timerSamples, 0),
      }),
    )
  } finally {
    shared.close()
    rmSync(directory, { recursive: true, force: true })
  }
}

/** Reproduce the successful per-second path at 0ee670f, without the new deadline query. */
function baselinePass(shared: LibraryRepository, libraries: PrivateLibraries): void {
  for (const id of libraries.accounts()) {
    const personal = libraries.open(id)
    try {
      const study = shared.forAccount(id, personal)
      study.synchronizeDeletions()
      new QuizService(study).expireDue()
    } finally {
      personal.close()
    }
  }
}
