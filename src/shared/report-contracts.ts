import type { QuizTiming } from './quiz-timing.ts'

export type ReportMode = 'all' | 'quiz' | 'exam' | 'review'

export type ReportCounts = {
  total: number
  answered: number
  correct: number
  incorrect: number
  skipped: number
  accuracy: number | null
  score: number | null
}

export type ReportBreakdown = {
  id: string
  name: string
  domain: number
  counts: ReportCounts
}

export type ReportAttempt = {
  id: string
  mode: 'quiz' | 'exam' | 'review'
  startedAt: number
  finishedAt: number
  counts: ReportCounts
  passed: boolean | null
  /** Wall-clock elapsed duration retained for API compatibility. */
  durationMs: number
  timing: QuizTiming
}

export type StudyReport = {
  certification: 'CLF-C02'
  generatedAt: number
  counts: ReportCounts
  targetAttempts: number
  unique: UniqueCoverage
  focus: FocusRecommendation
  passingAttempts: number
  attempts: ReportAttempt[]
  domains: ReportBreakdown[]
  topics: ReportBreakdown[]
  confidence: { name: string; counts: ReportCounts }[]
  timeline: { date: string; counts: ReportCounts; attempts: number }[]
}

export type UniqueCoverage = {
  encountered: number
  answered: number
  mastered: number
  firstEncounter: number
  afterPractice: number
  unknownIdentityAppearances: number
  unknownMasteryEvidenceAppearances: number
}

export type FocusEvidence = {
  domain: number
  distinctAnswered: number
  completedAttempts: number
  answeredAppearances: number
  totalAppearances: number
  score: number | null
  qualified: boolean
}

export type FocusRecommendation = {
  domain: number | null
  metric: 'score'
  domains: FocusEvidence[]
}
