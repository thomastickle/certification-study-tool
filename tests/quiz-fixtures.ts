import type { LibraryView } from '../src/server/questions/library-repository.ts'
import { ImportService } from '../src/server/importer/import-service.ts'
import { bank } from './fixtures.ts'

export function populate(
  repository: LibraryView,
  questionsPerDomain = 12,
  sourceKey = 'quiz-synthetic',
) {
  const input = bank(sourceKey)
  input.certification = { provider: 'AWS', code: 'CLF-C02', name: 'Synthetic CLF-C02' }
  input.questions = []
  for (let domain = 1; domain <= 4; domain++)
    for (let i = 0; i < questionsPerDomain; i++) {
      const question = structuredClone(bank().questions[0]!)
      question.source_ref = `d${domain}-${i}`
      question.question = `Synthetic domain ${domain} question ${i}?`
      question.source_metadata = { domain_id: domain }
      if (i % 2) {
        question.type = 'multi_select'
        question.select_count = 2
        question.answers[1]!.correct = true
        question.answers.push({ text: 'Example C', correct: false })
      }
      input.questions.push(question)
    }
  const service = new ImportService(repository)
  service.confirm(input, service.preview(input).token, false)
  return input
}
