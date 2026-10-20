import type { Confidence } from '../../shared/quiz-contracts.ts'

export type MasteryEvidence = {
  identity: string
  attemptId: string
  at: number
  answered: boolean
  correct: boolean
  confidence: Confidence | null
  unknown?: boolean
}

export type MasteryState = {
  encounters: number
  mastered: boolean
  masteryOrigin: 'first' | 'practice' | null
  boosted: boolean
  required: number
  progress: number
  recovery: 'miss' | 'uncertainty' | null
  missDay: string | null
  lastCreditDay: string | null
  dueDay: string | null
  retentionPassed: number
}

/** Calendar date in the learner's agreed study timezone. */
export function studyDay(at: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at)
}

/** Add calendar days without treating a DST study day as 24 elapsed hours. */
function later(day: string, days: number): string {
  const date = new Date(`${day}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

/** Replay ordered, scored evidence once per question and completed attempt. */
export function replayMastery(events: MasteryEvidence[]): Map<string, MasteryState> {
  const states = new Map<string, MasteryState>()
  const seen = new Set<string>()
  for (const event of [...events].sort(
    (a, b) => a.at - b.at || a.attemptId.localeCompare(b.attemptId),
  )) {
    const token = JSON.stringify([event.identity, event.attemptId])
    if (seen.has(token)) {
      continue
    }
    seen.add(token)
    const state = states.get(event.identity) ?? {
      encounters: 0,
      mastered: false,
      masteryOrigin: null,
      boosted: false,
      required: 0,
      progress: 0,
      recovery: null,
      missDay: null,
      lastCreditDay: null,
      dueDay: null,
      retentionPassed: 0,
    }
    states.set(event.identity, state)
    state.encounters++
    if (event.unknown || !event.answered) {
      continue
    }
    const day = studyDay(event.at)
    if (!event.correct) {
      let required = 3
      if (event.confidence === 'Unsure') {
        required = 1
      }
      if (event.confidence === 'Educated Guess') {
        required = 2
      }
      state.required = Math.max(state.required, required)
      state.progress = 0
      state.recovery = 'miss'
      state.missDay = day
      state.lastCreditDay = null
      state.mastered = false
      state.masteryOrigin = null
      state.boosted = true
      state.dueDay = null
      state.retentionPassed = 0
      continue
    }
    state.boosted = event.confidence !== null && event.confidence !== 'Confident'
    if (event.confidence === null) {
      continue
    }
    if (event.confidence !== 'Confident') {
      state.required = Math.max(state.required, event.confidence === 'Unsure' ? 2 : 1)
      state.recovery ??= 'uncertainty'
      state.mastered = false
      state.masteryOrigin = null
      continue
    }
    if (state.recovery) {
      if (state.recovery === 'miss' && (day <= state.missDay! || day === state.lastCreditDay)) {
        state.boosted = true
        continue
      }
      state.progress++
      state.lastCreditDay = day
      if (state.progress < state.required) {
        state.boosted = true
        continue
      }
      state.required = 0
      state.progress = 0
      state.recovery = null
      state.missDay = null
      state.lastCreditDay = null
    }
    if (!state.mastered) {
      state.mastered = true
      state.masteryOrigin = state.encounters === 1 ? 'first' : 'practice'
      if (state.dueDay === null && state.retentionPassed < 2) {
        state.dueDay = later(day, 7)
      }
    }
    if (state.dueDay !== null && day >= state.dueDay) {
      state.retentionPassed++
      state.dueDay = state.retentionPassed === 1 ? later(day, 14) : null
    }
  }
  return states
}
