import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { test } from 'node:test'
import type { StoredQuiz } from '../src/server/quizzes/quiz-repository.ts'
import { ReportService } from '../src/server/reports/report-service.ts'
import { apiController } from '../src/server/http-controller.ts'
import { LibraryRepository } from '../src/server/questions/library-repository.ts'

/** Exercises the report through the same local HTTP boundary as the dashboard. */
async function withReports(work: (base: string, repository: LibraryRepository) => Promise<void>) {
  const repository = new LibraryRepository(':memory:')
  const server = createServer(apiController(repository))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  try {
    await work(`http://127.0.0.1:${address.port}`, repository)
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
    repository.close()
  }
}

test('reports return an honest empty state and enforce local access', async () => {
  await withReports(async (base) => {
    const response = await fetch(`${base}/api/reports`)
    assert.equal(response.status, 200)
    const report = await response.json()
    assert.equal(report.counts.total, 0)
    assert.equal(report.counts.accuracy, null)
    assert.equal(report.counts.score, null)
    assert.deepEqual(report.attempts, [])
    assert.equal(report.domains.length, 4)
    assert.equal(
      (await fetch(`${base}/api/reports`, { headers: { Origin: 'https://untrusted.example' } }))
        .status,
      403,
    )
  })
})

/** Five independent questions make correct, incorrect and skipped denominators explicit. */
function attempt(id: string, finishedAt: number, mode: 'quiz' | 'exam' = 'quiz'): StoredQuiz {
  const correct =
    mode === 'quiz' ? [true, true, true, true, false] : [true, false, false, false, false]
  const answered = mode === 'quiz' ? 4 : 3
  return {
    id,
    status: 'completed',
    startedAt: finishedAt - 60000,
    finishedAt,
    deadline: finishedAt + 60000,
    serverNow: finishedAt,
    total: 5,
    correctCount: correct.filter(Boolean).length,
    ...(mode === 'exam' ? { mode } : {}),
    options: { sourceFilter: 'mixed', questionType: 'mixed' },
    keys: correct.map((_, i) => ({ fingerprint: `private-${i}`, correct: [0] })),
    questions: correct.map((result, i) => ({
      questionId: i,
      question: `Saved question ${i}`,
      type: 'single_select',
      selectCount: 1,
      answers: [
        { id: 0, text: 'Correct choice' },
        { id: 1, text: 'Wrong choice' },
      ],
      selected: i < answered ? [result ? 0 : 1] : [],
      correct: result,
      correctAnswerIds: [0],
      confidence: i === 0 ? 'Confident' : null,
      flagged: i === 1,
      domain: i < 2 ? 1 : 2,
      area: i < 2 ? 'Cloud fundamentals' : null,
      topic: i < 2 ? 'Cloud value' : null,
      sourceName: 'Deleted bank',
      sourceKind: 'third_party',
      reference: `saved-${i}`,
    })),
  }
}

test('reports weight question outcomes, retain skipped questions, and group historical snapshots', () => {
  const repository = new LibraryRepository(':memory:')
  try {
    const now = Date.UTC(2026, 9, 19, 12)
    repository.quizStore().save(attempt('old-quiz', now - 2 * 86400000))
    repository.quizStore().save(attempt('new-exam', now - 86400000, 'exam'))
    const abandoned = { ...attempt('abandoned', now), status: 'abandoned' as const }
    repository.quizStore().save(abandoned)
    const report = new ReportService(repository, () => now).get()
    assert.deepEqual(report.counts, {
      total: 10,
      answered: 7,
      correct: 5,
      incorrect: 2,
      skipped: 3,
      accuracy: 500 / 7,
      score: 50,
    })
    assert.equal(report.passingAttempts, 1)
    assert.deepEqual(
      report.attempts.map((a) => [a.id, a.mode, a.passed]),
      [
        ['new-exam', 'exam', false],
        ['old-quiz', 'quiz', true],
      ],
    )
    assert.equal(report.domains[0]!.counts.correct, 3)
    assert.equal(report.domains[1]!.counts.skipped, 3)
    assert.equal(report.domains[2]!.counts.accuracy, null)
    assert.equal(
      report.topics.find((t) => t.name === 'Cloud fundamentals · Cloud value')!.counts.total,
      4,
    )
    assert.equal(
      report.topics.find((t) => t.name === 'Unclassified · Unclassified')!.counts.total,
      6,
    )
    assert.equal(report.confidence.find((c) => c.name === 'Confident')!.counts.correct, 2)
    assert.deepEqual(
      report.timeline.map((d) => [d.date, d.counts.correct]),
      [
        ['2026-10-17', 4],
        ['2026-10-18', 1],
      ],
    )
    assert.doesNotMatch(JSON.stringify(report), /private-|Correct choice|Saved question/)
  } finally {
    repository.close()
  }
})

test('mode, certification and rolling time filters apply to all report sections and reject invalid input', async () => {
  await withReports(async (base, repository) => {
    const now = Date.now()
    repository.quizStore().save(attempt('legacy-quiz', now - 8 * 86400000))
    repository.quizStore().save(attempt('recent-exam', now - 86400000, 'exam'))
    const response = await fetch(`${base}/api/reports?mode=exam&days=7&certification=CLF-C02`)
    assert.equal(response.status, 200)
    const report = await response.json()
    assert.equal(report.counts.total, 5)
    assert.equal(report.counts.correct, 1)
    assert.deepEqual(
      report.attempts.map((a: { id: string }) => a.id),
      ['recent-exam'],
    )
    assert.equal(report.domains[0].counts.total, 2)
    assert.equal(report.timeline.length, 1)
    assert.equal(
      (await (await fetch(`${base}/api/reports?mode=quiz&days=7`)).json()).counts.total,
      0,
    )
    assert.equal((await (await fetch(`${base}/api/reports?mode=quiz`)).json()).counts.correct, 4)
    for (const query of ['mode=unknown', 'days=-1', 'days=7x', 'certification=SAA-C03']) {
      assert.equal((await fetch(`${base}/api/reports?${query}`)).status, 400, query)
    }
  })
})

test('master export records scope, skipped outcomes, domain evidence and individual attempts', async () => {
  const { studyReportMarkdown } = await import('../src/shared/report-export.ts')
  const repository = new LibraryRepository(':memory:')
  try {
    const now = Date.UTC(2026, 9, 19)
    repository.quizStore().save(attempt('saved-quiz', now))
    const text = studyReportMarkdown(
      new ReportService(repository, () => now).get(),
      'Quiz · All time',
    )
    assert.match(text, /CLF-C02 study report/)
    assert.match(text, /Quiz · All time/)
    assert.match(text, /4 correct, 0 incorrect, 1 skipped/)
    assert.match(text, /Score: 80% \(4\/5 questions; skips count as misses\)/)
    assert.match(text, /Accuracy on answered questions: 100% \(4 answered · 1 skipped\)/)
    assert.match(text, /Cloud Concepts/)
    assert.match(text, /saved-quiz/)
    assert.match(text, /Repeat questions count each time/)
  } finally {
    repository.close()
  }
})

test('report reads score expired attempts and remain stable after source deletion', async () => {
  const { populate } = await import('./quiz-fixtures.ts')
  const { QuizService } = await import('../src/server/quizzes/quiz-service.ts')
  const { LibraryService } = await import('../src/server/questions/library-service.ts')
  await withReports(async (base, repository) => {
    populate(repository)
    const service = new QuizService(repository, () => Date.now() - 25 * 60000)
    const quiz = service.start({ sourceFilter: 'mixed', questionType: 'mixed' })
    const stored = repository.quizStore().find(quiz.id)!
    service.save(quiz.id, {
      answers: quiz.questions.map((q, i) => ({
        questionId: q.questionId,
        selected: i === 0 ? stored.keys[i]!.correct : [],
        confidence: null,
        flagged: false,
      })),
    })
    const report = await (await fetch(`${base}/api/reports`)).json()
    assert.equal(report.attempts.length, 1)
    assert.equal(report.counts.correct, 1)
    assert.equal(report.counts.skipped, 19)
    assert.equal(repository.quizStore().find(quiz.id)!.status, 'completed')
    for (const source of repository.sources()) {
      new LibraryService(repository).deleteSource(source.id)
    }
    const after = await (await fetch(`${base}/api/reports`)).json()
    assert.deepEqual(after.counts, report.counts)
    assert.deepEqual(after.domains, report.domains)
  })
})

test('score-first exports and aggregates include skips, unequal sizes, domains and filtered days', async () => {
  const { studyReportMarkdown } = await import('../src/shared/report-export.ts')
  const repository = new LibraryRepository(':memory:')
  try {
    const now = Date.UTC(2026, 9, 19, 12)
    const base = attempt('eight-of-twenty', now)
    base.questions = Array.from({ length: 20 }, (_, i) => ({
      ...base.questions[0]!,
      questionId: i,
      domain: i < 10 ? 1 : 2,
      selected: i < 8 ? [0] : [],
      correct: i < 8,
    }))
    base.total = 20
    base.correctCount = 8
    repository.quizStore().save(base)
    const small = { ...attempt('exact-target', now - 1000), mode: 'exam' as const }
    repository.quizStore().save(small)
    const skipped = {
      ...base,
      id: 'all-skipped',
      finishedAt: now - 9 * 86400000,
      correctCount: 0,
      questions: base.questions.map((q) => ({ ...q, selected: [], correct: false })),
    }
    repository.quizStore().save(skipped)
    for (const status of ['active', 'paused'] as const) {
      repository
        .quizStore()
        .save({ ...base, id: status, status, finishedAt: null, correctCount: null })
    }
    const service = new ReportService(repository, () => now)
    const filtered = service.get({ days: '7', certification: 'CLF-C02' })
    assert.equal(filtered.counts.score, 48)
    assert.equal(filtered.passingAttempts, 1)
    assert.equal(filtered.attempts.length, 2)
    assert.equal(filtered.timeline[0]!.counts.score, 48)
    const quiz = service.get({ mode: 'quiz', days: '7' })
    assert.equal(quiz.counts.score, 40)
    assert.equal(quiz.counts.accuracy, 100)
    assert.equal(quiz.passingAttempts, 0)
    assert.equal(quiz.domains[0]!.counts.score, 80)
    assert.equal(quiz.domains[1]!.counts.score, 0)
    assert.equal(quiz.domains[1]!.counts.accuracy, null)
    assert.equal(quiz.domains[2]!.counts.score, null)
    assert.equal(service.get({ mode: 'exam' }).counts.score, 80)
    const all = service.get()
    assert.equal(all.counts.score, (12 / 45) * 100)
    assert.equal(all.attempts.find((a) => a.id === 'all-skipped')!.counts.score, 0)
    assert.equal(all.attempts.find((a) => a.id === 'all-skipped')!.counts.accuracy, null)
    const text = studyReportMarkdown(quiz, 'Quiz · Last 7 days')
    assert.match(text, /Score: 40% \(8\/20 questions; skips count as misses\)/)
    assert.match(text, /Accuracy on answered questions: 100% \(8 answered · 12 skipped\)/)
    assert.match(text, /Practice target met: 0\/1 attempts/)
    assert.match(text, /\| Cloud Concepts \| 8 \| 0 \| 8 \| 2 \| 80% \| 100% \|/)
    assert.match(text, /\| Security and Compliance \| 0 \| 0 \| 0 \| 10 \| 0% \| No data \|/)
    assert.match(text, /\| 2026-10-19 \| 8 \| 20 \| 8 \| 12 \| 40% \|/)
    assert.doesNotMatch(text, /Daily[^\n]*accuracy/i)
    const exam = studyReportMarkdown(service.get({ mode: 'exam', days: '7' }), 'Exam')
    assert.match(exam, /Score: 80%/)
  } finally {
    repository.close()
  }
})

test('empty and all-skipped master exports distinguish no measured score from zero', async () => {
  const { studyReportMarkdown } = await import('../src/shared/report-export.ts')
  const repository = new LibraryRepository(':memory:')
  try {
    const now = Date.UTC(2026, 9, 19)
    const service = new ReportService(repository, () => now)
    const empty = studyReportMarkdown(service.get(), 'Master · All time')
    assert.match(empty, /Score: No data \(0\/0 questions/)
    assert.match(empty, /Accuracy on answered questions: No data \(0 answered · 0 skipped\)/)
    const skipped = attempt('skipped', now)
    skipped.correctCount = 0
    skipped.questions = skipped.questions.map((q) => ({ ...q, selected: [], correct: false }))
    repository.quizStore().save(skipped)
    const report = service.get()
    assert.equal(report.counts.score, 0)
    assert.equal(report.counts.accuracy, null)
    assert.equal(report.passingAttempts, 0)
    const text = studyReportMarkdown(report, 'Master · All time')
    assert.match(text, /Score: 0% \(0\/5 questions/)
    assert.match(text, /Accuracy on answered questions: No data \(0 answered · 5 skipped\)/)
    assert.match(text, /\| 2026-10-19 \| 0 \| 5 \| 0 \| 5 \| 0% \|/)
  } finally {
    repository.close()
  }
})
