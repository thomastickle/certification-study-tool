export type JsonObject = { [key: string]: unknown }
export type Answer = JsonObject & { text: string; correct: boolean; rationale?: string | null }
export type Question = JsonObject & {
  source_ref?: string | null
  question: string
  type: 'single_select' | 'multi_select'
  select_count: number
  answers: Answer[]
  classification?: { area: string; topic: string }
  source_classification?: { area: string; topic?: string | null }
}
export type Bank = JsonObject & {
  schema_version: 2
  certification: { provider: string; code: string; name: string }
  source: JsonObject & { key: string; name: string; type: string; verification_status: string }
  questions: Question[]
}
export type Source = {
  id: number
  name: string
  kind: string
  key: string
  certification: string
  certificationName: string
  provider: string
  questionCount: number
}
export type StoredQuestion = {
  id: number
  sourceId: number
  sourceName: string
  reference: string
  data: Question
}
export type Change = { reference: string; before: Question; after: Question }
export type Preview = {
  token: string
  sourceName: string
  sourceKind: string
  certification: string
  total: number
  added: number
  unchanged: number
  changed: Change[]
  metadataChange: { before: JsonObject; after: JsonObject } | null
  duplicateCount: number
  conflicts: string[]
  unclassified: string[]
}
export type QuestionPage = {
  items: StoredQuestion[]
  total: number
  page: number
  pageSize: number
}
