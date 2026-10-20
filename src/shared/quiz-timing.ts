import type { QuizPause, QuizView } from './quiz-contracts.ts'

export type QuizTiming = {
  elapsedMs: number
  activeMs: number | null
  pausedMs: number | null
  pauseCount: number | null
  historyComplete: boolean
  pauses: (QuizPause & { durationMs: number })[]
}

/** Uses the server observation time for open intervals; legacy totals remain unknown. */
export function quizTiming(quiz: QuizView): QuizTiming {
  const end = quiz.finishedAt ?? quiz.serverNow
  const elapsedMs = Math.max(0, end - quiz.startedAt)
  const intervals = [...(quiz.pauseHistory?.intervals ?? [])]
  if (
    quiz.status === 'paused' &&
    quiz.pausedAt != null &&
    !intervals.some((p) => p.endedAt === null)
  ) {
    intervals.push({ startedAt: quiz.pausedAt, endedAt: null, cause: null })
  }
  const pauses = intervals.map((pause) => ({
    ...pause,
    durationMs: Math.max(0, Math.min(pause.endedAt ?? end, end) - pause.startedAt),
  }))
  const recordedPausedMs = pauses.reduce((total, pause) => total + pause.durationMs, 0)
  const historyComplete = quiz.pauseHistory?.complete === true
  return {
    elapsedMs,
    activeMs: historyComplete ? Math.max(0, elapsedMs - recordedPausedMs) : null,
    pausedMs: historyComplete ? recordedPausedMs : null,
    pauseCount: historyComplete ? pauses.length : null,
    historyComplete,
    pauses,
  }
}

/** Timing labels consistently truncate to whole seconds in HH:MM:SS. */
export function formatDuration(ms: number | null): string {
  if (ms === null) {
    return 'Not recorded'
  }
  const seconds = Math.floor(Math.max(0, ms) / 1000)
  return [Math.floor(seconds / 3600), Math.floor((seconds % 3600) / 60), seconds % 60]
    .map((value) => value.toString().padStart(2, '0'))
    .join(':')
}

/** Shares exact labels and rounding between individual and aggregate exports. */
export function timingSummary(timing: QuizTiming): string {
  return `Active study: ${formatDuration(timing.activeMs)} · Elapsed: ${formatDuration(timing.elapsedMs)} · Pauses: ${timing.pauseCount ?? 'Not recorded'} · Total paused: ${formatDuration(timing.pausedMs)}`
}
