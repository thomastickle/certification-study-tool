import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { QuizView } from '../src/shared/quiz-contracts.ts'
import { formatDuration, quizTiming } from '../src/shared/quiz-timing.ts'
import { quizReport } from '../src/shared/quiz-report.ts'
import { studyReportMarkdown } from '../src/shared/report-export.ts'
import { ReportService } from '../src/server/reports/report-service.ts'
import { LibraryRepository } from '../src/server/questions/library-repository.ts'
import { QuizService } from '../src/server/quizzes/quiz-service.ts'
import { populate } from './quiz-fixtures.ts'

const base: QuizView = {
  id: 'legacy',
  status: 'active',
  startedAt: 1000,
  deadline: 1201000,
  finishedAt: null,
  serverNow: 9000,
  correctCount: null,
  total: 0,
  options: { sourceFilter: 'mixed', questionType: 'mixed' },
  questions: [],
}

test('timing uses server time for ongoing pauses and never invents legacy totals', () => {
  const unknown = quizTiming(base)
  assert.equal(unknown.activeMs, null)
  assert.equal(unknown.pausedMs, null)
  assert.equal(unknown.pauseCount, null)
  assert.equal(unknown.elapsedMs, 8000)
  const paused = { ...base, status: 'paused' as const, pausedAt: 3000 }
  assert.deepEqual(quizTiming(paused).pauses, [
    { startedAt: 3000, endedAt: null, cause: null, durationMs: 6000 },
  ])
  const known = quizTiming({
    ...paused,
    pauseHistory: {
      complete: true,
      intervals: [{ startedAt: 3000, endedAt: null, cause: 'manual' }],
    },
  })
  assert.equal(known.activeMs, 2000)
  assert.equal(known.pausedMs, 6000)
  assert.equal(known.pauseCount, 1)
  const noPauses = quizTiming({ ...base, pauseHistory: { complete: true, intervals: [] } })
  assert.equal(noPauses.activeMs, 8000)
  assert.equal(noPauses.pauseCount, 0)
  assert.equal(formatDuration(3599999), '00:59:59')
  assert.equal(formatDuration(3600000), '01:00:00')
  assert.equal(formatDuration(null), 'Not recorded')
})

test('legacy resumed and newly paused snapshots retain known intervals without fabricating earlier history', () => {
  const repository = new LibraryRepository(':memory:')
  try {
    populate(repository)
    let now = 1000
    const service = new QuizService(repository, () => now)
    const quiz = service.start({ sourceFilter: 'mixed', questionType: 'mixed' })
    const stored = repository.quizStore().find(quiz.id)!
    delete stored.pauseHistory
    stored.status = 'paused'
    stored.pausedAt = 2000
    repository.quizStore().save(stored)
    now = 5000
    const resumed = service.resume(quiz.id)
    assert.equal(resumed.pauseHistory?.complete, false)
    assert.deepEqual(resumed.pauseHistory?.intervals, [
      { startedAt: 2000, endedAt: 5000, cause: null },
    ])
    now = 6000
    service.pause(quiz.id, { cause: 'navigation' })
    const timing = quizTiming(service.get(quiz.id))
    assert.equal(timing.pauseCount, null)
    assert.equal(timing.activeMs, null)
    assert.equal(timing.pauses.length, 2)
  } finally {
    repository.close()
  }
})

test('individual and master Markdown exports distinguish active, elapsed and per-pause durations', () => {
  const repository = new LibraryRepository(':memory:')
  try {
    populate(repository)
    let now = 1000
    const service = new QuizService(repository, () => now)
    const quiz = service.start({ sourceFilter: 'mixed', questionType: 'mixed' })
    now = 2000
    service.pause(quiz.id, { cause: 'navigation' })
    now = 7000
    service.resume(quiz.id)
    now = 10000
    const completed = service.submit(quiz.id, { answers: quiz.questions })
    const detail = quizReport(completed)
    assert.match(detail, /Active study: 00:00:04/)
    assert.match(detail, /Elapsed: 00:00:09/)
    assert.match(detail, /Pauses: 1/)
    assert.match(detail, /Total paused: 00:00:05/)
    assert.match(detail, /navigation.*00:00:05/)
    const report = new ReportService(repository, () => now).get()
    assert.match(studyReportMarkdown(report, 'All'), /Active study: 00:00:04.*Elapsed: 00:00:09/)
    const legacy = { ...completed }
    delete legacy.pauseHistory
    assert.match(quizReport(legacy), /Active study: Not recorded/)
    assert.match(quizReport(legacy), /Pauses: Not recorded/)
  } finally {
    repository.close()
  }
})
