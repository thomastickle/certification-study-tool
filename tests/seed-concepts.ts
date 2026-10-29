import { prepareRuntimeDatabase } from './managed-database-fixture.ts'
import { chmodSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { LibraryRepository } from '../src/server/questions/library-repository.ts'
import { QuizService } from '../src/server/quizzes/quiz-service.ts'
import { populate } from './quiz-fixtures.ts'

// A dedicated synthetic DB only. Refuse existing content rather than replacing any user's library.
const path = resolve('private/ai-runs/issue16/browser.sqlite3')
mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
prepareRuntimeDatabase(path)
const repository = new LibraryRepository(path)

try {
  if (repository.sources().length || repository.quizStore().completed().length) {
    throw new Error(
      'Synthetic concept preview database already populated. Choose a fresh test run.',
    )
  }
  populate(repository)
  repository.transaction(() => {
    for (const record of repository.allQuestions()) {
      if (record.reference.startsWith('d1-') && Number(record.reference.slice(3)) >= 6) {
        repository.deleteQuestion(record.id)
      }
    }
  })
  const service = new QuizService(
    repository,
    () => Date.parse('2026-10-19T16:00:00Z'),
    () => 0,
  )
  const quiz = service.start({ sourceFilter: 'mixed', questionType: 'mixed' })
  const keys = repository.quizStore().find(quiz.id)!.keys
  service.submit(quiz.id, {
    answers: quiz.questions.map((question, index) => ({
      ...question,
      selected: keys[index]!.correct,
      confidence: 'Confident',
    })),
  })
  chmodSync(path, 0o600)
} finally {
  repository.close()
}
