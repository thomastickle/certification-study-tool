import assert from 'node:assert/strict'
import { test } from 'node:test'
import { LibraryRepository } from '../src/server/questions/library-repository.ts'
import { QuizService } from '../src/server/quizzes/quiz-service.ts'
import { quizReport } from '../src/shared/quiz-report.ts'
import { populate } from './quiz-fixtures.ts'

test('export report includes every question, raw score, selected/correct answers, confidence and provenance', () => {
  const repository = new LibraryRepository(':memory:')
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
    assert.equal((report.match(/## Question /g) ?? []).length, 20)
    assert.match(report, /My answer: None/)
    assert.match(report, /Confidence: Educated Guess/)
    assert.match(report, /Confidence: Not recorded/)
    assert.match(report, /Marked for return: Yes/)
    assert.match(report, /Source: quiz-synthetic \(third_party\)/)
    assert.match(report, /Incorrect/)
    assert.match(report, /Correct answer: [ABC]/)
  } finally {
    repository.close()
  }
})
