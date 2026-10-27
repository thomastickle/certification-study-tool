import assert from 'node:assert/strict'
import type { StoredQuiz } from '../src/server/quizzes/quiz-repository.ts'
import { completedEvidence } from '../src/server/quizzes/mastery-history.ts'

/** Expand the accepted fixture's identity pool and answer distribution without changing saved keys. */
export function answeredBenchmarkHistory(
  template: StoredQuiz,
  sequence: number,
  epoch: number,
  pool: number,
): StoredQuiz {
  const quiz = structuredClone(template)
  const at = epoch - 8 * 86400000
  quiz.startedAt = at - 60000
  quiz.finishedAt = at
  quiz.serverNow = at
  quiz.deadline = at + 19 * 60000
  quiz.correctCount = 0
  for (const [index, question] of quiz.questions.entries()) {
    // Match real bank content/type: odd question numbers have the two-answer multi-select key.
    const slot = (sequence * 20 + index) % pool
    const domain = Math.floor(slot / (pool / 4)) + 1
    let ordinal = slot % (pool / 4)
    if ((ordinal % 2 === 1) !== (question.type === 'multi_select')) {
      ordinal = (ordinal + 1) % (pool / 4)
    }
    question.question = `Synthetic domain ${domain} question ${ordinal}?`
    question.domain = domain
    const category = ordinal % 6
    const correct = quiz.keys[index]!.correct
    question.selected = [...correct]
    question.confidence = 'Confident'
    if (category === 1) {
      question.confidence = 'Educated Guess'
    }
    if (category === 2) {
      question.confidence = 'Unsure'
    }
    if (category === 3) {
      question.selected = [question.answers.find((a) => !correct.includes(a.id))!.id]
    }
    if (category === 4) {
      question.confidence = null
    }
    if (category === 5) {
      question.selected = []
      question.confidence = null
    }
    question.correct =
      question.selected.length === correct.length &&
      question.selected.every((id) => correct.includes(id))
    if (question.correct) {
      quiz.correctCount++
    }
    const event = completedEvidence(quiz, index)
    assert.ok(event && !event.unknown, 'Diverse benchmark scoring must be accepted')
  }
  return quiz
}
