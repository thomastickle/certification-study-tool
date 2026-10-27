import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { apiController } from '../src/server/http-controller.ts'
import { requestUrl } from '../src/server/request-url.ts'
import { ImportPreviews } from '../src/server/importer/import-previews.ts'
import { ImportService } from '../src/server/importer/import-service.ts'
import { LibraryRepository } from '../src/server/questions/library-repository.ts'
import { LibraryService } from '../src/server/questions/library-service.ts'
import { PrivateLibraries } from '../src/server/questions/private-libraries.ts'
import { StudyHousekeeping } from '../src/server/questions/study-housekeeping.ts'
import type { LibraryItemId } from '../src/shared/contracts.ts'
import { assertHistoryEvidence, snapshotDigest } from './benchmark-history-evidence.ts'
import type { QuizView } from '../src/shared/quiz-contracts.ts'
import { QuizService } from '../src/server/quizzes/quiz-service.ts'
import { populate } from './quiz-fixtures.ts'
import { bank } from './fixtures.ts'
import { TimerProbe, summarize } from './performance-metrics.ts'

export interface Workload {
  owners: number
  histories: number
  questions: number
  backlog: number
}

export interface FixtureInfo {
  origin: string
  sharedSource: number
  privateSource: number
  startup: unknown
}

const config: Workload = JSON.parse(process.argv[2]!)
const directory = mkdtempSync(join(tmpdir(), 'study-foreground-benchmark-'))
const shared = new LibraryRepository(join(directory, 'shared.sqlite3'))
process.on('exit', () => {
  shared.close()
  rmSync(directory, { recursive: true, force: true })
})
process.on('SIGTERM', () => process.exit(1))
const libraries = new PrivateLibraries(join(directory, 'users'))
const owners = Array.from({ length: config.owners }, () => randomUUID())
const target = owners[0]!
const epoch = Date.now()
let monotonic = 0
const housekeeping = new StudyHousekeeping(shared, libraries, () => monotonic)
const previews = new ImportPreviews()
let probe: TimerProbe | undefined
let durations: number[] = []
let actorDurations: number[][] = []
let memoryStart = process.memoryUsage()
let peakRss = 0
let opens = 0
let activeConnections = 0
let peakConnections = 0
let observedOpens = 0
const originalOpen = libraries.open.bind(libraries)
libraries.open = (id) => {
  opens++
  const personal = originalOpen(id)
  activeConnections++
  peakConnections = Math.max(peakConnections, activeConnections)
  const close = personal.close.bind(personal)
  personal.close = () => {
    try {
      close()
    } finally {
      activeConnections--
    }
  }
  return personal
}

/** Build legitimate completed snapshots through the grading boundary before cloning history. */
function emptyAnswers(quiz: QuizView) {
  return quiz.questions.map((question) => ({
    questionId: question.questionId,
    selected: [],
    confidence: null,
    flagged: false,
  }))
}

// Reuse the scheduler benchmark's real 20-question snapshot and per-owner files.
populate(shared, config.questions / 4, 'shared-original')
const sharedService = new QuizService(shared, Date.now, () => 0.5)
const sharedQuiz = sharedService.start({ sourceFilter: 'mixed', questionType: 'mixed' })
const activeTemplate = shared.quizStore().find(sharedQuiz.id)!
sharedService.submit(sharedQuiz.id, { answers: emptyAnswers(sharedQuiz) })
const sharedTemplate = shared.quizStore().find(sharedQuiz.id)!
shared.quizStore().remove(sharedQuiz.id)
const seededSnapshots = new Map<string, Map<string, string>>()
const overdueIds = new Map<string, string>()
for (const [index, id] of owners.entries()) {
  const personal = libraries.open(id)
  try {
    populate(personal, 12, `private-owner-${index}`)
    const study = shared.forAccount(id, personal)
    const personalService = new QuizService(study, Date.now, () => 0.5)
    const ownQuiz = personalService.start({
      sourceFilter: 'mixed',
      questionType: 'mixed',
      sourceIds: ['private:1'],
    })
    personalService.submit(ownQuiz.id, { answers: emptyAnswers(ownQuiz) })
    const privateTemplate = personal.quizStore().find(ownQuiz.id)!
    personal.quizStore().remove(ownQuiz.id)
    const count = index === 0 ? config.histories : 10
    personal.quizStore().transaction(() => {
      for (let history = 0; history < count; history++) {
        const template = history % 2 === 0 ? sharedTemplate : privateTemplate
        personal.quizStore().save({
          ...structuredClone(template),
          id: randomUUID(),
          status: 'completed',
          finishedAt: epoch,
          correctCount: 0,
        })
      }
      personal.quizStore().save({
        ...structuredClone(activeTemplate),
        id: randomUUID(),
        status: 'active',
        finishedAt: null,
        correctCount: null,
        deadline: epoch - 1,
      })
      personal.quizStore().save({
        ...structuredClone(sharedTemplate),
        id: randomUUID(),
        status: 'deleted',
        deletedAt: epoch - 49 * 60 * 60_000,
        purgeAt: epoch - 1,
      })
    })
    assert.equal(personal.quizStore().active().length, 1)
    assert.equal(personal.quizStore().deleted().length, 1)
    seededSnapshots.set(
      id,
      new Map(
        personal
          .quizStore()
          .completed()
          .map((quiz) => [quiz.id, snapshotDigest(quiz)]),
      ),
    )
    overdueIds.set(id, personal.quizStore().active()[0]!.id)
  } finally {
    personal.close()
  }
}
new LibraryService(shared).deleteSource(1)
for (let index = 1; index < config.backlog; index++) {
  const input = bank(`backlog-${index}`)
  const importer = new ImportService(shared)
  importer.confirm(input, importer.preview(input).token, false)
  new LibraryService(shared).deleteSource(shared.sources()[0]!.id)
}
// Restore a live bank for foreground quiz creation and shared deletion.
const liveBank = populate(shared, config.questions / 4, 'shared-live')
const sharedSource = shared.sources()[0]!.id as number

/** Match the request-owned connection/cleanup boundary used by main, bypassing OIDC only. */
const server = createServer(async (request, response) => {
  const start = performance.now()
  // The harness selects only precreated synthetic actors; no account comes from payload/query.
  const actor = owners[Number(request.headers['x-synthetic-actor'] ?? 0)]
  assert.ok(actor)
  const personal = libraries.open(actor)
  try {
    const url = new URL(request.url ?? '/', `http://127.0.0.1:${request.socket.localPort}`)
    const context = requestUrl(url)
    const controller = apiController(
      shared,
      { id: actor, role: 'admin' },
      undefined,
      previews,
      personal,
    )
    await controller(request, response, context)
  } finally {
    housekeeping.observeRequest(request.method, actor, personal)
    personal.close()
    const elapsed = performance.now() - start
    durations.push(elapsed)
    const actorIndex = owners.indexOf(actor)
    actorDurations[actorIndex] ??= []
    actorDurations[actorIndex]!.push(elapsed)
  }
})

/** Time maintenance separately from fixture setup and foreground HTTP. */
async function maintenance() {
  const timer = new TimerProbe()
  const before = opens
  const start = performance.now()
  await housekeeping.tick()
  const elapsedMs = performance.now() - start
  const timerDelay = await timer.stop()
  assert.equal(activeConnections, 0)
  return { elapsedMs, opens: opens - before, timerDelay, activeConnections }
}

const originalSnapshots = new Map<string, Map<string, string>>()
const startup = await maintenance()
assert.equal(startup.opens, config.owners)
for (const [index, id] of owners.entries()) {
  const personal = libraries.open(id)
  try {
    assert.equal(personal.sharedDeletionCursor(), config.backlog)
    assert.equal(personal.quizStore().active().length, 0)
    assert.equal(personal.quizStore().deleted().length, 0)
    assert.equal(personal.quizStore().completed().length, (index === 0 ? config.histories : 10) + 1)
    const histories = personal.quizStore().completed()
    const originals = new Map(histories.map((quiz) => [quiz.id, snapshotDigest(quiz)]))
    assertHistoryEvidence(histories, seededSnapshots.get(id)!, new Map([[1, 'shared-original']]), [
      overdueIds.get(id)!,
    ])
    originalSnapshots.set(id, originals)
  } finally {
    personal.close()
  }
}
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
const address = server.address()
assert.ok(address && typeof address !== 'string')
process.send!({
  ready: { origin: `http://127.0.0.1:${address.port}`, sharedSource, privateSource: 1, startup },
})

/** Keep control/setup outside the regions sampled by the independent HTTP client. */
async function command(name: string, completedId?: string) {
  if (name === 'begin') {
    durations = []
    actorDurations = []
    memoryStart = process.memoryUsage()
    peakRss = memoryStart.rss
    observedOpens = opens
    peakConnections = 0
    probe = new TimerProbe(() => {
      peakRss = Math.max(peakRss, process.memoryUsage().rss)
    })
    return null
  }
  if (name === 'end') {
    assert.ok(probe)
    const timerDelay = await probe.stop()
    assert.equal(activeConnections, 0)
    return {
      requestServiceMs: summarize(durations),
      actorServiceMs: actorDurations.map(summarize),
      memory: { start: memoryStart, end: process.memoryUsage(), sampledPeakRss: peakRss },
      opens: opens - observedOpens,
      timerDelay,
      activeConnections,
      peakConnections,
    }
  }
  if (name === 'bank') {
    return {
      ...liveBank,
      source: { ...liveBank.source, key: 'foreground-import', name: 'foreground-import' },
    }
  }
  if (name === 'replay') {
    // Recreate a lagging owner without timing fixture construction or reopening another user's data.
    const personal = libraries.open(target)
    try {
      personal.quizStore().transaction(() => {
        for (const quiz of personal.quizStore().completed()) {
          delete quiz.deletedBankNames
          personal.quizStore().save(quiz)
        }
        personal.saveSharedDeletionCursor(0)
      })
    } finally {
      personal.close()
    }
    return null
  }
  if (name === 'recurring') {
    monotonic += 5000
    return maintenance()
  }
  if (name === 'records') {
    return owners.slice(0, 2).map((id) => {
      const personal = libraries.open(id)
      try {
        return personal
          .quizStore()
          .completed()
          .map((quiz) => ({
            id: quiz.id,
            deletedBankNames: [...(quiz.deletedBankNames ?? [])].sort(),
          }))
      } finally {
        personal.close()
      }
    })
  }
  if (name === 'verify') {
    const personal = libraries.open(target)
    const other = libraries.open(owners[1]!)
    try {
      const histories = personal.quizStore().completed()
      assert.equal(personal.sharedDeletionCursor(), config.backlog + 1)
      assert.equal(histories.length, config.histories + 2)
      assert.ok(completedId)
      const deleted = new Map<LibraryItemId, string>([
        [1, 'shared-original'],
        [sharedSource, 'shared-live'],
        ['private:1', 'private-owner-0'],
      ])
      assertHistoryEvidence(histories, originalSnapshots.get(target)!, deleted, [completedId])
      assertHistoryEvidence(
        other.quizStore().completed(),
        originalSnapshots.get(owners[1]!)!,
        new Map([
          [1, 'shared-original'],
          [sharedSource, 'shared-live'],
        ]),
      )
      assert.equal(other.sources().length, 1)
      assert.equal(other.sources()[0]!.name, 'private-owner-1')
      assert.equal(shared.quizStore().completed().length, 0)
      assert.ok(histories.every((quiz) => quiz.questions.length === 20 && quiz.keys.length === 20))
      assert.ok(histories.every((quiz) => quiz.correctCount !== null))
      return {
        histories: histories.length,
        otherHistories: 11,
        cursor: personal.sharedDeletionCursor(),
        isolated: true,
      }
    } finally {
      personal.close()
      other.close()
    }
  }
  throw new Error('Unknown benchmark command')
}

process.on('message', (message: { name: string; completedId?: string }) => {
  command(message.name, message.completedId)
    .then((result) => process.send!({ result }))
    .catch((error: unknown) => {
      process.send!({ error: String(error) })
    })
})

process.on('disconnect', () => {
  server.close(() => process.exit(0))
})
