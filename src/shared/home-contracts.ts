export type ReadinessStatus = 'insufficient' | 'unsupported' | 'red' | 'yellow' | 'green'

export const readinessThresholds = { marginal: 80, ready: 90 } as const

export type Readiness = {
  basis?: 'blueprint' | 'practice'
  status: ReadinessStatus
  score: number | null
  blendedScore: number | null
  mastery: number | null
  examAverage: number | null
  exams: { day: string; score: number }[]
  domains: { name: string; distinctAnswered: number; score: number | null }[]
  reasons: string[]
}

export type CertificationProgress = {
  deletedBankAttemptCount?: number
  provider: string
  code: string
  name: string
  sourceIds: number[]
  earned: boolean
  dueCount: number
  readiness: Readiness
}

export type HomeSummary = {
  generatedAt: number
  providers: {
    name: string
    total: number
    ready: number
    dueCount: number
    certifications: CertificationProgress[]
  }[]
}
