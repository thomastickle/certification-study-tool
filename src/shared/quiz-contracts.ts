export type Confidence = 'Confident' | 'Educated Guess' | 'Unsure'

export type PracticeMode = 'quiz' | 'exam' | 'review'

export type QuizOptions = {
  mode?: PracticeMode
  sourceFilter: 'mixed' | 'official' | 'third_party'
  sourceIds?: number[]
  questionType: 'mixed' | 'single_select' | 'multi_select'
}

export type QuizAnswer = {
  questionId: number
  selected: number[]
  confidence: Confidence | null
  flagged: boolean
}

export type QuizQuestion = QuizAnswer & {
  question: string
  type: 'single_select' | 'multi_select'
  selectCount: number
  answers: { id: number; text: string }[]
  domain: number
  sourceName: string
  sourceKind: string
  reference: string
  area: string | null
  topic: string | null
  concepts?: { id: string; name: string }[]
  variationNote?: string
  correctAnswerIds?: number[]
  correct?: boolean
}

export type QuizSummary = {
  mode?: PracticeMode
  id: string
  status: 'active' | 'paused' | 'completed' | 'abandoned'
  startedAt: number
  deadline: number
  finishedAt: number | null
  correctCount: number | null
  total: number
}

export type PauseCause = 'manual' | 'navigation'

export type QuizPause = {
  startedAt: number
  endedAt: number | null
  cause: PauseCause | null
}

export type QuizView = QuizSummary & {
  // Missing or incomplete history must never imply zero historical pauses.
  pauseHistory?: { complete: boolean; intervals: QuizPause[] }
  pausedAt?: number | null
  serverNow: number
  questions: QuizQuestion[]
  options: QuizOptions
}

export type DueReviewSummary = {
  total: number
  eligible: number
  excluded: number
  unavailable: number
  oldestDay: string | null
}
