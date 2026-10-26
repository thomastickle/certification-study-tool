import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { test } from 'node:test'
import { LibraryRepository } from '../src/server/questions/library-repository.ts'
import { QuizService } from '../src/server/quizzes/quiz-service.ts'
import { apiController } from '../src/server/http-controller.ts'
import { studyReportMarkdown } from '../src/shared/report-export.ts'
import { quizTiming } from '../src/shared/quiz-timing.ts'
import { populate } from './quiz-fixtures.ts'

for (const mode of ['quiz', 'exam'] as const) {
  test(`${mode} HTTP keeps overdue paused work out of every report and grades eventual completion once`, async () => {
    const repository = new LibraryRepository(':memory:')
    populate(repository, 24)
    let now = Date.now() - 24 * 60 * 60000
    const service = new QuizService(repository, () => now)
    const quiz = service.start({ mode, sourceFilter: 'mixed', questionType: 'mixed' })
    const keys = repository.quizStore().find(quiz.id)!.keys
    const answers = quiz.questions.map((q, i) => ({
      questionId: q.questionId,
      selected: keys[i]!.correct,
      confidence: 'Confident',
      flagged: true,
    }))
    service.save(quiz.id, { answers })
    now += 1234
    service.pause(quiz.id, { cause: 'navigation' })
    const server = createServer(apiController(repository, { id: 'local', role: 'admin' }))
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    assert.ok(address && typeof address !== 'string')
    const base = `http://127.0.0.1:${address.port}`

    const post = (action: string, input?: unknown) =>
      fetch(`${base}/api/quizzes/${quiz.id}/${action}`, {
        method: 'POST',
        ...(input === undefined
          ? {}
          : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }),
      })

    try {
      const paused = await (await fetch(`${base}/api/quizzes/${quiz.id}`)).json()
      assert.equal(paused.status, 'paused')
      assert.ok(paused.serverNow > quiz.deadline)
      assert.ok(quizTiming(paused).pauses[0]!.durationMs > 23 * 60 * 60000)
      assert.equal(quizTiming(paused).pauses[0]!.endedAt, null)
      assert.deepEqual(
        paused.questions.map((q: { selected: number[] }) => q.selected),
        answers.map((q) => q.selected),
      )
      const empty = await (await fetch(`${base}/api/reports`)).json()
      assert.equal(empty.counts.total, 0)
      assert.equal(empty.counts.accuracy, null)
      assert.equal(empty.passingAttempts, 0)
      assert.deepEqual(empty.attempts, [])
      assert.deepEqual(empty.topics, [])
      assert.deepEqual(empty.timeline, [])
      assert.ok(empty.domains.every((d: { counts: { total: number } }) => d.counts.total === 0))
      assert.ok(empty.confidence.every((d: { counts: { total: number } }) => d.counts.total === 0))
      assert.doesNotMatch(studyReportMarkdown(empty, 'All'), new RegExp(quiz.id))
      assert.equal(repository.quizStore().boosts().size, 0)
      assert.equal(
        (await post('pause')).status,
        200,
        'Older empty-body pause requests stay supported',
      )
      assert.equal((await post('pause', { cause: 'invented' })).status, 400)
      const retry = await (await post('pause', { cause: 'manual' })).json()
      assert.deepEqual(retry.pauseHistory, paused.pauseHistory)
      const resumed = await (await post('resume', {})).json()
      assert.equal(resumed.status, 'active')
      assert.ok(resumed.deadline - resumed.serverNow <= quiz.deadline - paused.pausedAt)
      assert.ok(resumed.deadline - resumed.serverNow > quiz.deadline - paused.pausedAt - 1000)
      assert.equal((await (await post('resume', {})).json()).deadline, resumed.deadline)
      repository.quizStore().record(keys[0]!.fingerprint, false)
      await post('submit', { answers })
      await post('submit', { answers: [] })
      const report = await (await fetch(`${base}/api/reports`)).json()
      assert.equal(report.attempts.length, 1)
      assert.equal(report.counts.correct, quiz.total)
      assert.equal(report.counts.total, quiz.total)
      assert.equal(report.counts.score, 100)
      assert.equal(report.passingAttempts, 1)
      assert.equal(report.attempts[0].timing.pauseCount, 1)
      assert.equal(report.attempts[0].timing.pauses[0].cause, 'navigation')
      // Old streak-table writes cannot override completed confidence-based evidence.
      repository.quizStore().record(keys[0]!.fingerprint, true)
      assert.equal(repository.quizStore().boosts().has(keys[0]!.fingerprint), false)
      assert.ok(
        repository
          .quizStore()
          .find(quiz.id)!
          .questions.every((q) => q.correct),
      )
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
      repository.close()
    }
  })
}
