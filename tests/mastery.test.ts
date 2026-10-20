import assert from 'node:assert/strict'
import { test } from 'node:test'
import { replayMastery, studyDay } from '../src/server/quizzes/mastery.ts'
import type { MasteryEvidence } from '../src/server/quizzes/mastery.ts'

const start = Date.parse('2026-03-07T17:00:00Z')

/** Separate attempts may share a study day; dates deliberately span spring DST. */
function event(index: number, change: Partial<MasteryEvidence> = {}): MasteryEvidence {
  return {
    identity: 'q',
    attemptId: String(index),
    at: start + index * 1000,
    answered: true,
    correct: true,
    confidence: 'Confident',
    ...change,
  }
}

/** Inspect the observable scheduling state for one question. */
function state(events: MasteryEvidence[]) {
  return replayMastery(events).get('q')!
}

test('first confident success masters; blank and skipped first encounters never invent first mastery', () => {
  assert.equal(state([event(0)]).masteryOrigin, 'first')
  for (const first of [
    event(0, { confidence: null }),
    event(0, { answered: false, correct: false }),
  ]) {
    assert.equal(state([first]).mastered, false)
    assert.equal(state([first]).boosted, false)
    assert.equal(state([first, event(1)]).masteryOrigin, 'practice')
  }
})

test('explicit uncertainty needs one or two later attempts; same-day practice counts once per attempt', () => {
  for (const [confidence, required] of [
    ['Educated Guess', 1],
    ['Unsure', 2],
  ] as const) {
    const first = event(0, { confidence })
    assert.equal(state([first]).required, required)
    assert.equal(state([first]).boosted, true)
    assert.equal(state([first, event(1), event(1)]).mastered, required === 1)
    assert.equal(state([first, event(1), event(2)]).mastered, true)
    assert.equal(state([first, event(1), event(2)]).masteryOrigin, 'practice')
  }
})

test('all miss confidence branches require later distinct New York study days', () => {
  for (const [confidence, required] of [
    ['Confident', 3],
    [null, 3],
    ['Educated Guess', 2],
    ['Unsure', 1],
  ] as const) {
    const events = [event(0, { correct: false, confidence }), event(1)]
    assert.equal(state(events).progress, 0)
    assert.equal(state(events).required, required)
    for (let day = 1; day <= required; day++) {
      // Noon New York after spring DST, less than 24h after the first miss.
      events.push(
        event(day + 1, { at: Date.parse(`2026-03-${String(7 + day).padStart(2, '0')}T16:00:00Z`) }),
      )
      assert.equal(state(events).mastered, day === required)
      events.push({ ...events.at(-1)!, attemptId: `repeat-${day}` })
    }
    assert.equal(state(events).mastered, true)
  }
})

test('latest miss resets progress and boundary without weakening stronger unresolved recovery', () => {
  const events = [event(0, { correct: false }), event(1, { at: start + 86400000 })]
  assert.equal(state(events).progress, 1)
  events.push(event(2, { at: start + 2 * 86400000, correct: false, confidence: 'Unsure' }))
  assert.equal(state(events).required, 3)
  assert.equal(state(events).progress, 0)
  events.push(event(3, { at: start + 2 * 86400000 + 1000 }))
  assert.equal(state(events).progress, 0)
})

test('correct blank and low confidence preserve progress; skip changes neither boost nor progress', () => {
  const events = [event(0, { correct: false }), event(1, { at: start + 86400000 })]
  for (const confidence of ['Educated Guess', 'Unsure', null] as const) {
    const next = [...events, event(2, { confidence, at: start + 86400001 })]
    assert.equal(state(next).progress, 1)
    assert.equal(state(next).boosted, confidence !== null)
    assert.deepEqual(state([...next, event(3, { answered: false, correct: false })]), {
      ...state(next),
      encounters: state(next).encounters + 1,
    })
  }
  assert.equal(state([event(0), event(1, { confidence: null })]).mastered, true)
  assert.equal(state([event(0), event(1, { confidence: 'Unsure' })]).mastered, false)
})

test('retention is calendar based, remains due for skips/nonconfident outcomes, and ends after two checks', () => {
  const events = [event(0)]
  assert.equal(state(events).dueDay, '2026-03-14')
  events.push(event(1, { at: Date.parse('2026-03-14T03:59:59Z') }))
  assert.equal(studyDay(events[1]!.at), '2026-03-13')
  assert.equal(state(events).retentionPassed, 0)
  events.push(event(2, { at: Date.parse('2026-03-14T04:00:00Z'), confidence: null }))
  events.push(event(3, { at: Date.parse('2026-03-15T16:00:00Z'), answered: false }))
  assert.equal(state(events).dueDay, '2026-03-14')
  events.push(event(4, { at: Date.parse('2026-03-16T16:00:00Z') }))
  assert.equal(state(events).dueDay, '2026-03-30')
  events.push(event(5, { at: Date.parse('2026-03-30T16:00:00Z') }))
  assert.equal(state(events).dueDay, null)
  assert.equal(state(events).retentionPassed, 2)
  assert.equal(studyDay(Date.parse('2026-11-01T04:00:00Z')), '2026-11-01')
  assert.equal(studyDay(Date.parse('2026-11-02T04:59:59Z')), '2026-11-01')
})

test('a wrong retention answer starts recovery and re-earned mastery starts a new schedule', () => {
  const events = [
    event(0),
    event(1, { at: start + 8 * 86400000, correct: false, confidence: 'Unsure' }),
  ]
  assert.equal(state(events).dueDay, null)
  assert.equal(state(events).mastered, false)
  events.push(event(2, { at: start + 9 * 86400000 }))
  assert.equal(state(events).masteryOrigin, 'practice')
  assert.equal(state(events).dueDay, '2026-03-23')
})
