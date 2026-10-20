import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LibraryRepository } from '../src/server/questions/library-repository.ts'
import { QuizService } from '../src/server/quizzes/quiz-service.ts'
import { ReportService } from '../src/server/reports/report-service.ts'
import { populate } from './quiz-fixtures.ts'

for (const mode of ['quiz', 'exam'] as const) {
  test(`${mode} retains multiple pause intervals and causes across restart, excluding pauses from active time`, () => {
    const directory = mkdtempSync(join(tmpdir(), 'pause-history-'))
    const path = join(directory, 'synthetic.sqlite3')
    let repository = new LibraryRepository(path)
    let now = 1000
    let service = new QuizService(repository, () => now)
    try {
      populate(repository, 24)
      const quiz = service.start({ mode, sourceFilter: 'mixed', questionType: 'mixed' })
      now = 2000
      service.pause(quiz.id, { cause: 'navigation' })
      now = 3000
      service.pause(quiz.id, { cause: 'manual' })
      assert.deepEqual(service.get(quiz.id).pauseHistory, {
        complete: true,
        intervals: [{ startedAt: 2000, endedAt: null, cause: 'navigation' }],
      })
      repository.close()
      repository = new LibraryRepository(path)
      service = new QuizService(repository, () => now)
      now = quiz.deadline + 86400000
      service.expireDue()
      assert.equal(service.get(quiz.id).status, 'paused')
      assert.deepEqual(new ReportService(repository, () => now).get().attempts, [])
      assert.equal(repository.quizStore().boosts().size, 0)
      const resumed = service.resume(quiz.id)
      assert.equal(resumed.deadline - now, quiz.deadline - 2000)
      const firstEnd = now
      now += 1000
      assert.equal(service.resume(quiz.id).deadline, resumed.deadline)
      service.pause(quiz.id, { cause: 'manual' })
      now += 2000
      service.resume(quiz.id)
      now += 3000
      const answers = quiz.questions.map((question) => ({ ...question, selected: [] }))
      const completed = service.submit(quiz.id, { answers })
      assert.deepEqual(completed.pauseHistory, {
        complete: true,
        intervals: [
          { startedAt: 2000, endedAt: firstEnd, cause: 'navigation' },
          { startedAt: firstEnd + 1000, endedAt: firstEnd + 3000, cause: 'manual' },
        ],
      })
      const report = new ReportService(repository, () => now).get()
      assert.equal(report.attempts[0]!.timing.activeMs, 5000)
      assert.equal(report.attempts[0]!.timing.elapsedMs, now - 1000)
      assert.equal(report.attempts[0]!.timing.pausedMs, firstEnd - 2000 + 2000)
      assert.equal(report.attempts[0]!.timing.pauseCount, 2)
      const mastery = repository.quizStore().boosts()
      service.submit(quiz.id, { answers })
      service.expireDue()
      service.pause(quiz.id)
      service.resume(quiz.id)
      assert.equal(service.recent().length, 1)
      assert.deepEqual(repository.quizStore().boosts(), mastery)
    } finally {
      repository.close()
      rmSync(directory, { recursive: true })
    }
  })

  test(`${mode} deadline wins before pause and retries never extend active time`, () => {
    const repository = new LibraryRepository(':memory:')
    try {
      populate(repository, 24)
      let now = 1000
      const service = new QuizService(repository, () => now)
      const quiz = service.start({ mode, sourceFilter: 'mixed', questionType: 'mixed' })
      now = quiz.deadline - 1
      service.pause(quiz.id)
      now += 10000
      const resumed = service.resume(quiz.id)
      now = resumed.deadline
      const completed = service.pause(quiz.id, { cause: 'navigation' })
      assert.equal(completed.status, 'completed')
      assert.equal(completed.finishedAt, resumed.deadline)
      assert.equal(completed.pauseHistory?.intervals.length, 1)
      assert.equal(
        new ReportService(repository, () => now).get().attempts[0]!.timing.activeMs,
        (mode === 'exam' ? 90 : 20) * 60000,
      )
    } finally {
      repository.close()
    }
  })
}

test('pause uses one server acceptance timestamp at a moving deadline boundary', () => {
  const repository = new LibraryRepository(':memory:')
  try {
    populate(repository)
    let now = 1000
    let observations: number[] = []
    const service = new QuizService(repository, () => observations.shift() ?? now)
    const quiz = service.start({ sourceFilter: 'mixed', questionType: 'mixed' })
    now = quiz.deadline
    observations = [quiz.deadline - 1, quiz.deadline]
    const paused = service.pause(quiz.id)
    assert.equal(paused.status, 'paused')
    assert.equal(paused.pausedAt, quiz.deadline - 1)
    assert.equal(service.resume(quiz.id).deadline - now, 1)
  } finally {
    repository.close()
  }
})
