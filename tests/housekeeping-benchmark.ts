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
      const personal = libraries.open(randomUUID())
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
    const open = libraries.open.bind(libraries)
    const accounts = libraries.accounts.bind(libraries)
    libraries.open = (id) => {
      opens++
      const personal = open(id)
      connections++
      peakConnections = Math.max(peakConnections, connections)
      const close = personal.close.bind(personal)
      personal.close = () => {
        try {
          close()
        } finally {
          connections--
        }
      }
      return personal
    }
    libraries.accounts = () => {
      discoveries++
      return accounts()
    }
    const blocking: number[] = []
    const eventLoopDelay: number[] = []
    for (tick = 0; tick < 20; tick++) {
      const start = performance.now()
      const pendingTimer = delay(0).then(() => performance.now() - start)
      const realNow = Date.now
      try {
        Date.now = () => epoch + tick * 1000
        if (mode === 'baseline') {
          baselinePass(shared, libraries)
        } else {
          scheduler.tick()
        }
      } finally {
        Date.now = realNow
      }
      blocking.push(performance.now() - start)
      eventLoopDelay.push(await pendingTimer)
    }
    // Validate equal useful work without counting these verification connections as upkeep.
    let completed = 0
    for (const id of accounts()) {
      const personal = open(id)
      try {
        assert.equal(personal.sharedDeletionCursor(), 1)
        assert.equal(personal.quizStore().active().length, 0)
        assert.equal(personal.quizStore().deleted().length, 0)
        completed += personal.quizStore().completed().length
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
        startupBlockingMs: blocking[0],
        recurringBlockingMs: blocking.slice(1).reduce((sum, ms) => sum + ms, 0),
        maxTimerDelayMs: Math.max(...eventLoopDelay),
        recurringMaxTimerDelayMs: Math.max(...eventLoopDelay.slice(1)),
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
