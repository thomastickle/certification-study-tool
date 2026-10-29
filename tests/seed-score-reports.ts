import { prepareRuntimeDatabase } from './managed-database-fixture.ts'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { LibraryRepository } from '../src/server/questions/library-repository.ts'
import type { StoredQuiz } from '../src/server/quizzes/quiz-repository.ts'

// Run only against a new disposable database; never use a personal study library.
const database = process.argv[2]
if (!database || existsSync(database)) {
  throw new Error('Provide a new disposable database path for synthetic score-report fixtures.')
}
mkdirSync(dirname(resolve(database)), { recursive: true, mode: 0o700 })
prepareRuntimeDatabase(database)
const repository = new LibraryRepository(database)
const now = Date.now() - 60000
for (const [id, mode, total, correctCount, age] of [
  ['00000000-0000-4000-8000-000000000001', 'quiz', 20, 8, 0],
  ['00000000-0000-4000-8000-000000000002', 'exam', 65, 52, 86400000],
  ['00000000-0000-4000-8000-000000000003', 'quiz', 20, 0, 10 * 86400000],
] as const) {
  const finishedAt = now - age
  const quiz: StoredQuiz = {
    id,
    mode,
    total,
    correctCount,
    status: 'completed',
    startedAt: finishedAt - 60000,
    deadline: finishedAt + 60000,
    finishedAt,
    serverNow: finishedAt,
    options: { mode, sourceFilter: 'mixed', questionType: 'mixed' },
    keys: Array.from({ length: total }, (_, i) => ({
      fingerprint: `synthetic-score-${id}-${i}`,
      correct: [0],
    })),
    questions: Array.from({ length: total }, (_, i) => ({
      questionId: i,
      question: `Synthetic score question ${i}`,
      type: 'single_select',
      selectCount: 1,
      answers: [
        { id: 0, text: 'Synthetic correct' },
        { id: 1, text: 'Synthetic incorrect' },
      ],
      selected: i < correctCount ? [0] : [],
      correct: i < correctCount,
      correctAnswerIds: [0],
      confidence: null,
      flagged: false,
      domain: i < Math.ceil(total / 2) ? 1 : 2,
      area: 'Synthetic area',
      topic: 'Synthetic topic',
      sourceName: 'Synthetic score fixture',
      sourceKind: 'third_party',
      reference: `synthetic-${i}`,
    })),
  }
  repository.quizStore().save(quiz)
}
repository.close()
