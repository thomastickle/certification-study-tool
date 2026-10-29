import { prepareManagedDatabase } from './managed-database-fixture.ts'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { LibraryRepository } from '../src/server/questions/library-repository.ts'
import { QuizService } from '../src/server/quizzes/quiz-service.ts'
import { quizReport } from '../src/shared/quiz-report.ts'
import { populate } from './quiz-fixtures.ts'

test('export report includes every question, raw score, selected/correct answers, confidence and provenance', () => {
  const repository = new LibraryRepository(prepareManagedDatabase())
  try {
    populate(repository)
    const service = new QuizService(repository, () => 1000)
    const quiz = service.start({ sourceFilter: 'mixed', questionType: 'mixed' })
    assert.throws(() => quizReport(quiz), /Submit and score/)
    const stored = repository.quizStore().find(quiz.id)!
    const result = service.submit(quiz.id, {
      answers: quiz.questions.map((q, i) => ({
        questionId: q.questionId,
        selected: i < 16 ? stored.keys[i]!.correct : [],
        confidence: i === 0 ? 'Educated Guess' : null,
        flagged: i === 0,
      })),
    })
    const report = quizReport(result)
    assert.match(report, /Pass — 16\/20 \(80%\)/)
    assert.match(report, /Score: 80% \(16\/20 questions; skips count as misses\)/)
    assert.match(report, /Accuracy on answered questions: 100% \(16 answered · 4 skipped\)/)
    assert.equal((report.match(/## Question /g) ?? []).length, 20)
    assert.match(report, /My answer: None/)
    assert.match(report, /Confidence: Educated Guess/)
    assert.match(report, /Confidence: Not recorded/)
    assert.match(report, /Marked for review: Yes/)
    assert.match(report, /Source: quiz-synthetic \(third_party\)/)
    assert.match(report, /Incorrect/)
    assert.match(report, /Correct answer: [ABC]/)
  } finally {
    repository.close()
  }
})

test('exam report exports use the exam snapshot mode and preserve quiz fallback', () => {
  const repository = new LibraryRepository(prepareManagedDatabase())
  try {
    populate(repository)
    const service = new QuizService(repository, () => 1000)
    const quiz = service.start({ sourceFilter: 'mixed', questionType: 'mixed' })
    const completed = service.submit(quiz.id, {
      answers: quiz.questions.map((q) => ({
        questionId: q.questionId,
        selected: [],
        confidence: null,
        flagged: false,
      })),
    })
    assert.match(quizReport(completed), /# CLF-C02 practice quiz report/)
    assert.match(quizReport(completed), /Score: 0%/)
    assert.match(
      quizReport(completed),
      /Accuracy on answered questions: No data \(0 answered · 20 skipped\)/,
    )
    // This case models an options-only snapshot; the new engine also sets a top-level mode.
    delete completed.mode
    completed.options.mode = 'exam'
    assert.match(quizReport(completed), /# CLF-C02 practice exam report/)
    assert.match(quizReport(completed), new RegExp(`Exam: ${completed.id}`))
    delete completed.options.mode
    completed.mode = 'exam'
    assert.equal(quizReport(completed).startsWith('# CLF-C02 practice exam report'), true)
    completed.options.mode = 'quiz'
    assert.equal(quizReport(completed).startsWith('# CLF-C02 practice exam report'), true)
    completed.mode = 'quiz'
    completed.options.mode = 'exam'
    assert.equal(quizReport(completed).startsWith('# CLF-C02 practice quiz report'), true)
  } finally {
    repository.close()
  }
})

test('quiz and exam exports use total questions for primary scores and retain detailed answered accuracy', () => {
  const repository = new LibraryRepository(prepareManagedDatabase())
  try {
    populate(repository, 24)
    const service = new QuizService(repository, () => 1000)
    for (const mode of ['quiz', 'exam'] as const) {
      const quiz = service.start({ mode, sourceFilter: 'mixed', questionType: 'mixed' })
      const stored = repository.quizStore().find(quiz.id)!
      const result = service.submit(quiz.id, {
        answers: quiz.questions.map((q, i) => ({
          questionId: q.questionId,
          selected: i < 8 ? stored.keys[i]!.correct : [],
          confidence: null,
          flagged: false,
        })),
      })
      const report = quizReport(result)
      assert.match(report, new RegExp(`Score: ${mode === 'quiz' ? 40 : 12}%`))
      assert.match(report, new RegExp(`Fail — 8/${quiz.total}`))
      assert.match(
        report,
        new RegExp(
          `Accuracy on answered questions: 100% \\(8 answered · ${quiz.total - 8} skipped\\)`,
        ),
      )
    }
  } finally {
    repository.close()
  }
})

test('an individual report without questions has no measured score', () => {
  const repository = new LibraryRepository(prepareManagedDatabase())
  try {
    populate(repository)
    const service = new QuizService(repository, () => 1000)
    const quiz = service.start({ sourceFilter: 'mixed', questionType: 'mixed' })
    const completed = service.submit(quiz.id, {
      answers: quiz.questions.map((question) => ({
        questionId: question.questionId,
        selected: [],
        confidence: null,
        flagged: false,
      })),
    })
    const report = quizReport({ ...completed, total: 0, correctCount: 0, questions: [] })
    assert.match(report, /Score: No data \(0\/0 questions/)
    assert.doesNotMatch(report, /NaN|Infinity|Result: Pass/)
  } finally {
    repository.close()
  }
})
