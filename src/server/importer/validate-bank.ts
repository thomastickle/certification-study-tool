import { readFileSync } from 'node:fs'
import { Ajv2020 } from 'ajv/dist/2020.js'
import type { Bank } from '../../shared/contracts.ts'
import { ApplicationError } from '../errors.ts'
import { matchText, reference } from './bank-tools.ts'

const schema = JSON.parse(
  readFileSync(new URL('../../../docs/question-bank.schema.json', import.meta.url), 'utf8'),
)
const ajv = new Ajv2020({ allErrors: true, strict: false })
ajv.addFormat(
  'date',
  (value) =>
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value,
)
const validate = ajv.compile<Bank>(schema)

export function validateBank(input: unknown): Bank {
  if (!validate(input)) {
    const errors = [
      ...new Set(
        (validate.errors ?? []).map((error) => {
          const match = error.instancePath.match(/^\/questions\/(\d+)/)
          const label = match ? `Question ${Number(match[1]) + 1}` : 'Bank'
          return `${label} ${error.instancePath || '/'}: ${error.message}`
        }),
      ),
    ]
    throw new ApplicationError('The file failed validation. Nothing was imported.', 422, errors)
  }
  const errors: string[] = []
  const refs = new Set<string>()
  const officialStatuses = new Set(['official_current', 'official_older'])
  if (
    input.source.type === 'third_party' &&
    officialStatuses.has(input.source.verification_status)
  ) {
    errors.push('Bank: a third-party source cannot claim official verification status.')
  }
  input.questions.forEach((q, index) => {
    const label = `Question ${index + 1} (${q.source_ref ?? 'no source reference'})`
    if (q.answers.filter((a) => a.correct).length !== q.select_count)
      errors.push(`${label}: select_count must match the number of correct answers.`)
    const texts = q.answers.map((a) => matchText(a.text))
    if (new Set(texts).size !== texts.length)
      errors.push(`${label}: answer choices are indistinguishable after text normalization.`)
    if (!matchText(q.question) || texts.some((t) => !t))
      errors.push(`${label}: question and answers need meaningful text.`)
    const ref = reference(q)
    if (refs.has(ref))
      errors.push(`${label}: duplicate source reference or unreferenced identical question.`)
    refs.add(ref)
    if (
      input.source.type === 'third_party' &&
      officialStatuses.has(String(q.verification_status))
    ) {
      errors.push(`${label}: a third-party question cannot claim official status.`)
    }
  })
  if (errors.length)
    throw new ApplicationError('The file failed validation. Nothing was imported.', 422, errors)
  return input
}
