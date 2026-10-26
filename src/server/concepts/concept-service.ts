import { randomUUID } from 'node:crypto'
import { digest } from '../importer/bank-tools.ts'
import { ApplicationError } from '../errors.ts'
import { currentQuestionIdentity } from '../quizzes/question-identity.ts'
import type { LibraryView } from '../questions/library-repository.ts'
import type {
  ConceptGroup,
  ConceptMember,
  ConceptSuggestion,
} from '../../shared/concept-contracts.ts'

/** Review local label candidates independently of bank content. */
export class ConceptService {
  private repository: LibraryView

  constructor(repository: LibraryView) {
    this.repository = repository
  }

  /** List reviewable variations by their exact provider/certification namespace. */
  library(): { provider: string; certification: string; members: ConceptMember[] }[] {
    const sources = new Map(this.repository.sources().map((source) => [source.id, source]))
    const scopes = new Map<
      string,
      { provider: string; certification: string; members: ConceptMember[] }
    >()
    for (const member of this.catalog().values()) {
      const source = sources.get(member.occurrences[0]!.sourceId)!
      const key = JSON.stringify([source.provider, source.certification])
      let scope = scopes.get(key)
      if (!scope) {
        scope = { provider: source.provider, certification: source.certification, members: [] }
        scopes.set(key, scope)
      }
      scope.members.push(member)
    }
    return [...scopes.values()]
  }

  /** Resolve current occurrences only; disappeared content never inherits a reviewed mapping. */
  catalog(): Map<string, ConceptMember> {
    const sources = new Map(this.repository.sources().map((source) => [source.id, source]))
    const members = new Map<string, ConceptMember>()
    for (const record of this.repository.allQuestions()) {
      const source = sources.get(record.sourceId)
      const identity = source && currentQuestionIdentity(record, source)
      if (!identity) {
        continue
      }
      const previous = members.get(identity)
      if (previous) {
        previous.occurrences.push({
          id: record.id,
          sourceId: record.sourceId,
          sourceName: record.sourceName,
          reference: record.reference,
          data: record.data,
        })
      } else {
        members.set(identity, {
          id: record.id,
          reviewToken: digest(['concept-review', identity]),
          occurrences: [
            {
              id: record.id,
              sourceId: record.sourceId,
              sourceName: record.sourceName,
              reference: record.reference,
              data: record.data,
            },
          ],
        })
      }
    }
    return members
  }

  /** Reviewed groups may retain unavailable identities so source deletion cannot remap them. */
  groups(): ConceptGroup[] {
    const catalog = this.catalog()
    return this.repository
      .conceptStore()
      .all()
      .map(({ identities, ...group }) => {
        const members = identities.flatMap((identity) => catalog.get(identity) ?? [])
        return { ...group, members, unavailableCount: identities.length - members.length }
      })
  }

  /** Validate all members before one atomic save. @throws {ApplicationError} For stale/invalid review. */
  save(input: unknown, id?: string): ConceptGroup {
    return this.repository.transaction(() => {
      if (!input || typeof input !== 'object') {
        throw new ApplicationError('Review a name, certification and question members first.')
      }
      const value = input as Record<string, unknown>
      const { provider, certification } = value
      const name = typeof value.name === 'string' ? value.name.trim().replace(/\s+/g, ' ') : ''
      if (
        !name ||
        [...name].some(
          (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
        ) ||
        name.length > 120 ||
        typeof provider !== 'string' ||
        typeof certification !== 'string'
      ) {
        throw new ApplicationError('Choose a concept name (1–120 characters) and certification.')
      }
      const store = this.repository.conceptStore()
      const groups = store.all()
      const previous = groups.find((group) => group.id === id)
      if (id && !previous) {
        throw new ApplicationError('Concept group not found.', 404)
      }
      if (
        previous &&
        (previous.provider !== provider || previous.certification !== certification)
      ) {
        throw new ApplicationError('A concept group cannot change certification.')
      }
      if (
        groups.some(
          (group) =>
            group.id !== id &&
            group.provider === provider &&
            group.certification === certification &&
            group.name.toLocaleLowerCase('en-US') === name.toLocaleLowerCase('en-US'),
        )
      ) {
        throw new ApplicationError('Choose a distinct concept name for this certification.', 409)
      }
      if (value.members === undefined && previous) {
        store.save({ ...previous, name })
        return this.groups().find((group) => group.id === id)!
      }
      if (!Array.isArray(value.members) || value.members.length === 0) {
        throw new ApplicationError('Select at least one reviewed question.')
      }
      const catalog = this.catalog()
      const sources = new Map(this.repository.sources().map((source) => [source.id, source]))
      const identities = value.members.map((item: unknown) => {
        if (!item || typeof item !== 'object') {
          throw new ApplicationError('Refresh the question list and review its members again.', 409)
        }
        const member = item as Record<string, unknown>
        const entry = [...catalog].find(([, current]) =>
          current.occurrences.some((record) => record.id === member.id),
        )
        const source = entry && sources.get(entry[1].occurrences[0]!.sourceId)
        if (
          !entry ||
          member.reviewToken !== entry[1].reviewToken ||
          source?.provider !== provider ||
          source?.certification !== certification
        ) {
          throw new ApplicationError(
            'A question changed, disappeared or belongs to another certification. Refresh and review again.',
            409,
          )
        }
        return entry[0]
      })
      if (new Set(identities).size !== identities.length) {
        throw new ApplicationError(
          'Exact duplicate occurrences count as one variation. Select each variation once.',
        )
      }
      const groupId = id ?? randomUUID()
      store.save({ id: groupId, name, provider, certification, identities })
      return this.groups().find((group) => group.id === groupId)!
    })
  }

  /** Remove live membership only; saved attempt labels remain snapshots. */
  remove(id: string): void {
    this.repository.transaction(() => {
      if (!this.repository.conceptStore().remove(id)) {
        throw new ApplicationError('Concept group not found.', 404)
      }
    })
  }

  /** Dismiss exactly the currently reviewed candidate without activating any membership. */
  dismiss(id: string): void {
    this.repository.transaction(() => {
      if (!this.suggestions().some((suggestion) => suggestion.id === id)) {
        throw new ApplicationError(
          'Suggestion changed or disappeared. Refresh and review again.',
          409,
        )
      }
      this.repository.conceptStore().dismiss(id)
    })
  }

  /** Suggest complete matching labels within one certification; labels do not prove equivalence. */
  suggestions(): ConceptSuggestion[] {
    const sources = new Map(this.repository.sources().map((source) => [source.id, source]))
    const reviewed = new Set(
      this.repository
        .conceptStore()
        .all()
        .flatMap((group) => group.identities),
    )
    const candidates = new Map<string, ConceptSuggestion>()
    for (const [identity, member] of this.catalog()) {
      if (reviewed.has(identity)) {
        continue
      }
      for (const record of member.occurrences) {
        const source = sources.get(record.sourceId)!
        const area = record.data.classification?.area?.trim()
        const topic = record.data.classification?.topic?.trim()
        if (!area || !topic) {
          continue
        }
        const key = JSON.stringify([source.provider, source.certification, area, topic])
        let candidate = candidates.get(key)
        if (!candidate) {
          candidate = {
            id: '',
            provider: source.provider,
            certification: source.certification,
            name: topic,
            area,
            topic,
            members: [],
          }
          candidates.set(key, candidate)
        }
        if (!candidate.members.some((current) => current.reviewToken === member.reviewToken)) {
          candidate.members.push(member)
        }
      }
    }
    const dismissed = this.repository.conceptStore().dismissed()
    return [...candidates.values()].filter((candidate) => {
      candidate.id = digest([
        candidate.provider,
        candidate.certification,
        candidate.area,
        candidate.topic,
        candidate.members.map((member) => member.reviewToken).sort(),
      ])
      return candidate.members.length > 1 && !dismissed.has(candidate.id)
    })
  }
}
