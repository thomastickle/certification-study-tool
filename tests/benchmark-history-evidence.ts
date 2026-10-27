import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { completedEvidence } from '../src/server/quizzes/mastery-history.ts'
import type { StoredQuiz } from '../src/server/quizzes/quiz-repository.ts'
import type { LibraryItemId } from '../src/shared/contracts.ts'

/** Hash saved answers and grading evidence separately from mutable deletion indicators. */
export function snapshotDigest(quiz: StoredQuiz): string {
  return createHash('sha256')
    .update(JSON.stringify([quiz.questions, quiz.keys, quiz.options, quiz.correctCount]))
    .digest('hex')
}

/**
 * Require original identities/evidence and exact annotations for each namespaced source.
 * @throws {AssertionError} When identities, saved evidence or deletion indicators differ.
 */
export function assertHistoryEvidence(
  histories: StoredQuiz[],
  originals: Map<string, string>,
  deletedSources: Map<LibraryItemId, string>,
  addedIds: string[] = [],
) {
  assert.deepEqual(
    histories.map((quiz) => quiz.id).sort(),
    [...originals.keys(), ...addedIds].sort(),
    'Saved history identities must survive without replacement or cross-account substitution',
  )
  for (const quiz of histories) {
    if (originals.has(quiz.id)) {
      assert.equal(snapshotDigest(quiz), originals.get(quiz.id), 'Saved evidence must survive')
    }
    const expected = new Set<string>()
    for (const question of quiz.questions) {
      const marker = deletedSources.get(question.sourceId!)
      if (marker) {
        expected.add(marker)
      }
    }
    assert.deepEqual(
      [...(quiz.deletedBankNames ?? [])].sort(),
      [...expected].sort(),
      'Deletion indicators must match exactly the deleted sources in this snapshot',
    )
  }
}

/**
 * Require ordinary benchmark histories to exercise accepted scoring, with coherent timer metadata.
 * @throws {AssertionError} When a seeded or recovered attempt is malformed or has unknown scoring.
 */
export function assertCompletedBenchmarkEvidence(histories: StoredQuiz[]) {
  for (const quiz of histories) {
    assert.equal(quiz.status, 'completed')
    for (let index = 0; index < quiz.questions.length; index++) {
      assert.ok(completedEvidence(quiz, index), 'Benchmark scoring evidence must be valid')
    }
    assert.ok(quiz.startedAt <= quiz.finishedAt! && quiz.finishedAt! <= quiz.deadline)
    assert.ok(quiz.serverNow >= quiz.startedAt && quiz.serverNow <= quiz.finishedAt!)
    assert.equal(quiz.pausedAt ?? null, null)
    assert.deepEqual(quiz.pauseHistory, { complete: true, intervals: [] })
  }
}
