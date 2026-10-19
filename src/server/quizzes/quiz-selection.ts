import type { QuizOptions } from '../../shared/quiz-contracts.ts'
import type { QuestionRecord } from '../questions/library-repository.ts'
import type { Source } from '../../shared/contracts.ts'
import { ApplicationError } from '../errors.ts'
import { domainQuotas, examDomain } from './domain-mapping.ts'

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
): { record: QuestionRecord; domain: number }[] {
  const sourceMap = new Map(sources.map((s) => [s.id, s]))
  const groups = new Map<string, { record: QuestionRecord; domain: number }>()
  for (const record of questions) {
    const source = sourceMap.get(record.sourceId)
    if (!source || source.provider !== 'AWS' || source.certification !== 'CLF-C02') continue
    if (options.sourceIds && !options.sourceIds.includes(source.id)) continue
    if (options.sourceFilter !== 'mixed' && source.kind !== options.sourceFilter) continue
    if (options.questionType !== 'mixed' && record.data.type !== options.questionType) continue
    const domain = examDomain(record.data)
    if (!domain) continue
    const previous = groups.get(record.fingerprint)
    if (previous && previous.record.answerKey !== record.answerKey)
      throw new ApplicationError(
        `Conflicting answer keys for ${record.reference}; resolve the source conflict before starting a quiz.`,
        409,
      )
    // Prefer official provenance for the same question when mixing sources.
    if (!previous || source.kind === 'official') groups.set(record.fingerprint, { record, domain })
  }
  const selected: { record: QuestionRecord; domain: number }[] = []
  domainQuotas.forEach((quota, index) => {
    const pool = [...groups.values()].filter((q) => q.domain === index + 1)
    if (pool.length < quota)
      throw new ApplicationError(
        `Domain ${index + 1} needs ${quota} unique mapped questions; only ${pool.length} match these filters. Choose broader filters or import more questions.`,
        422,
      )
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
      selected.push(pool.splice(chosen, 1)[0]!)
    }
  })
  return shuffled(selected, random)
}
