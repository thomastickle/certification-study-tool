import { certificationScope, isClf } from './certification-scope.ts'
import type { QuizOptions } from '../../shared/quiz-contracts.ts'
import type { QuestionRecord } from '../questions/library-repository.ts'
import type { Source } from '../../shared/contracts.ts'
import type { ReviewedConcept } from '../concepts/concept-repository.ts'
import { preferVariation } from '../concepts/concept-variations.ts'
import { currentQuestionIdentity } from './question-identity.ts'
import { ApplicationError } from '../http/errors.ts'
import { domainQuotas, examDomain, examDomainQuotas } from './domain-mapping.ts'

export function shuffled<T>(values: readonly T[], random = Math.random): T[] {
  const result = [...values]
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[result[i], result[j]] = [result[j]!, result[i]!]
  }
  return result
}

export function selectQuestions(
  questions: QuestionRecord[],
  sources: Source[],
  options: QuizOptions,
  boosted: Set<string>,
  random = Math.random,
  concepts?: { groups: ReviewedConcept[]; recency: Map<string, number> },
  identities?: ReadonlyMap<QuestionRecord, string | null>,
): { record: QuestionRecord; domain: number }[] {
  const groups = eligibleQuestions(questions, sources, options)
  const sourceMap = new Map(sources.map((source) => [source.id, source]))
  const used = new Set<string>()
  const selected: { record: QuestionRecord; domain: number }[] = []
  const clf = isClf(options)
  let quotas: readonly number[] = options.mode === 'exam' ? examDomainQuotas : domainQuotas
  if (!clf) {
    quotas = [options.mode === 'exam' ? 65 : 20]
  }
  quotas.forEach((quota, index) => {
    const pool = [...groups.values()].filter((q) => !clf || q.domain === index + 1)
    if (pool.length < quota) {
      throw new ApplicationError(
        `${clf ? `Domain ${index + 1}` : 'This certification'} needs ${quota} unique ${clf ? 'mapped ' : ''}questions; only ${pool.length} match these filters. Choose broader filters or import more questions.`,
        422,
      )
    }
    for (let i = 0; i < quota; i++) {
      const weights = pool.map((q) => (boosted.has(q.record.fingerprint) ? 3 : 1))
      let target = random() * weights.reduce((a, b) => a + b, 0)
      let chosen = weights.length - 1
      for (let j = 0; j < weights.length; j++) {
        target -= weights[j]!
        if (target < 0) {
          chosen = j
          break
        }
      }
      if (concepts?.groups.length) {
        const candidates = pool.map((picked) => ({
          ...picked,
          identity:
            (identities
              ? identities.get(picked.record)
              : currentQuestionIdentity(picked.record, sourceMap.get(picked.record.sourceId)!)) ??
            '',
          tier: boosted.has(picked.record.fingerprint) ? 3 : 1,
        }))
        const preferred = preferVariation(
          candidates[chosen]!,
          candidates,
          concepts.groups,
          concepts.recency,
          random,
          used,
        )
        chosen = pool.findIndex((picked) => picked.record.id === preferred.record.id)
        used.add(preferred.identity)
      }
      selected.push(pool.splice(chosen, 1)[0]!)
    }
  })
  return shuffled(selected, random)
}

/**
 * Apply exact requested filters and deduplicate without changing domain quotas.
 * @throws {ApplicationError} When matching source occurrences disagree on the answer key.
 */
export function eligibleQuestions(
  questions: QuestionRecord[],
  sources: Source[],
  options: QuizOptions,
) {
  const sourceMap = new Map(sources.map((s) => [s.id, s]))
  const scope = certificationScope(options)
  const groups = new Map<string, { record: QuestionRecord; domain: number }>()
  for (const record of questions) {
    const source = sourceMap.get(record.sourceId)
    if (
      !source ||
      source.provider !== scope.provider ||
      source.certification !== scope.certification
    ) {
      continue
    }
    if (options.sourceIds && !options.sourceIds.includes(source.id)) continue
    if (options.sourceFilter !== 'mixed' && source.kind !== options.sourceFilter) continue
    if (options.questionType !== 'mixed' && record.data.type !== options.questionType) continue
    const domain = isClf(options) ? examDomain(record.data) : 0
    if (domain === null) {
      continue
    }
    const previous = groups.get(record.fingerprint)
    if (previous && previous.record.answerKey !== record.answerKey)
      throw new ApplicationError(
        `Conflicting answer keys for ${record.reference}; resolve the source conflict before starting a quiz.`,
        409,
      )
    // Prefer official provenance for the same question when mixing sources.
    if (!previous || source.kind === 'official') groups.set(record.fingerprint, { record, domain })
  }
  return groups
}
