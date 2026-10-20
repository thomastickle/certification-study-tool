import { existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { LibraryRepository } from '../src/server/questions/library-repository.ts'
import { QuizService } from '../src/server/quizzes/quiz-service.ts'
import { populate } from './quiz-fixtures.ts'

const database = process.argv[2]
if (!database || existsSync(database)) {
  throw new Error('Provide a new disposable database path for synthetic mastery fixtures.')
}
mkdirSync(dirname(resolve(database)), { recursive: true, mode: 0o700 })
const repository = new LibraryRepository(database)
try {
  populate(repository)
  const service = new QuizService(
    repository,
    () => Date.now() - 8 * 86400000,
    () => 0.2,
  )
  const quiz = service.start({ sourceFilter: 'mixed', questionType: 'mixed' })
  const keys = repository.quizStore().find(quiz.id)!.keys
  service.submit(quiz.id, {
    answers: quiz.questions.map((q, i) => ({
      ...q,
      selected: keys[i]!.correct,
      confidence: 'Confident',
    })),
  })
} finally {
  repository.close()
}
