import type { StoredQuestion } from './contracts.ts'

export type ConceptMemberInput = { id: number; reviewToken: string }

export type ConceptMember = ConceptMemberInput & { occurrences: StoredQuestion[] }

export type ConceptScope = { provider: string; certification: string }

export type ConceptGroup = ConceptScope & {
  id: string
  name: string
  members: ConceptMember[]
  unavailableCount: number
}

export type ConceptSuggestion = ConceptScope & {
  id: string
  name: string
  area: string
  topic: string
  members: ConceptMember[]
}

export type ConceptInput = ConceptScope & { name: string; members: ConceptMemberInput[] }
