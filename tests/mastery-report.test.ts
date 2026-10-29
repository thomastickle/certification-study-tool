import { prepareManagedDatabase } from './managed-database-fixture.ts'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { LibraryRepository } from '../src/server/questions/library-repository.ts'
import { QuizService } from '../src/server/quizzes/quiz-service.ts'
import { ReportService } from '../src/server/reports/report-service.ts'
import { studyReportMarkdown } from '../src/shared/report-export.ts'
import type { StoredQuiz } from '../src/server/quizzes/quiz-repository.ts'
import { populate } from './quiz-fixtures.ts'

/** Forty distinct questions let every supported domain meet the evidence gate. */
function sample(repository: LibraryRepository, id: string, at: number): StoredQuiz {
  const service = new QuizService(
    repository,
    () => at,
    () => 0.1,
  )
  const started = service.start({ sourceFilter: 'mixed', questionType: 'mixed' })
  const template = started.questions[0]!
  service.abandon(started.id)
  const questions = Array.from({ length: 40 }, (_, i) => ({
    ...template,
    questionId: i,
    domain: Math.floor(i / 10) + 1,
    question: `Distinct synthetic question ${i}`,
    type: 'single_select' as const,
    selectCount: 1,
    answers: [
      { id: 0, text: 'Correct' },
      { id: 1, text: 'Wrong' },
    ],
    selected: [0],
    correctAnswerIds: [0],
    correct: true,
    confidence: 'Confident' as const,
  }))
  return {
    ...started,
    id,
    status: 'completed',
    finishedAt: at,
    questions,
    total: 40,
    correctCount: 40,
    keys: questions.map(() => ({ fingerprint: 'private-fingerprint', correct: [0] })),
  }
}

test('report separates repeat activity, unique coverage and lifetime mastery without recomputing first-ever under filters', () => {
  const repository = new LibraryRepository(prepareManagedDatabase())
  try {
    populate(repository)
    const now = Date.parse('2026-10-20T16:00:00Z')
    const first = sample(repository, 'first', now - 8 * 86400000)
    first.questions[0]!.selected = []
    first.questions[0]!.correct = false
    first.correctCount = 39
    const second = sample(repository, 'second', now)
    repository.quizStore().save(first)
    repository.quizStore().save(second)
    const service = new ReportService(repository, () => now)
    const report = service.get()
    assert.equal(report.counts.total, 80)
    assert.equal(report.unique.encountered, 40)
    assert.equal(report.unique.mastered, 40)
    assert.equal(report.unique.firstEncounter, 39)
    assert.equal(report.unique.afterPractice, 1)
    assert.equal(report.focus.domain, 1)
    assert.equal(report.focus.domains[0]!.distinctAnswered, 10)
    assert.equal(report.focus.domains[0]!.completedAttempts, 2)
    const filtered = service.get({ days: '7' })
    assert.equal(filtered.counts.total, 40)
    assert.equal(filtered.unique.afterPractice, 1)
    assert.equal(filtered.focus.domain, null)
    assert.equal(filtered.focus.domains[0]!.completedAttempts, 1)
    assert.match(studyReportMarkdown(filtered, 'Last 7 days'), /Lifetime mastery/)
    assert.match(studyReportMarkdown(filtered, 'Last 7 days'), /Insufficient evidence/)
    assert.doesNotMatch(
      JSON.stringify(report),
      /private-fingerprint|mastery:v1|Distinct synthetic question|Correct/,
    )
  } finally {
    repository.close()
  }
})

test('repeats do not qualify tiny domains; missing identity and confidence stay unknown', () => {
  const repository = new LibraryRepository(prepareManagedDatabase())
  try {
    populate(repository)
    const now = Date.now()
    const first = sample(repository, 'one', now - 1000)
    first.questions = first.questions.slice(0, 1)
    first.keys = first.keys.slice(0, 1)
    first.total = 1
    first.correctCount = 1
    const second = { ...structuredClone(first), id: 'two', finishedAt: now }
    repository.quizStore().save(first)
    repository.quizStore().save(second)
    const report = new ReportService(repository, () => now).get()
    assert.equal(report.unique.encountered, 1)
    assert.equal(report.focus.domain, null)
    assert.equal(report.focus.domains[0]!.distinctAnswered, 1)
    assert.equal(report.focus.domains[0]!.completedAttempts, 2)
    second.questions[0]!.correctAnswerIds = [999]
    first.questions[0]!.confidence = undefined as never
    repository.quizStore().save(first)
    repository.quizStore().save(second)
    const unknown = new ReportService(repository, () => now).get()
    assert.equal(unknown.unique.unknownIdentityAppearances, 1)
    assert.equal(unknown.unique.unknownMasteryEvidenceAppearances, 2)
    assert.equal(unknown.unique.mastered, 0)
  } finally {
    repository.close()
  }
})
