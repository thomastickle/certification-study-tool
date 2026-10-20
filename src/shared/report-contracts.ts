export type ReportMode = 'all' | 'quiz' | 'exam'

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
  mode: 'quiz' | 'exam'
  startedAt: number
  finishedAt: number
  counts: ReportCounts
  passed: boolean
  durationMs: number
}

export type StudyReport = {
  certification: 'CLF-C02'
  generatedAt: number
  counts: ReportCounts
  passingAttempts: number
  attempts: ReportAttempt[]
  domains: ReportBreakdown[]
  topics: ReportBreakdown[]
  confidence: { name: string; counts: ReportCounts }[]
  timeline: { date: string; counts: ReportCounts; attempts: number }[]
}
