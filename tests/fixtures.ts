import type { Bank } from '../src/shared/contracts.ts'

export function bank(key = 'synthetic-bank'): Bank {
  return {
    schema_version: 2,
    certification: { provider: 'Example', code: 'DEMO-1', name: 'Synthetic exam' },
    source: { key, name: key, type: 'third_party', verification_status: 'unverified' },
    questions: [
      {
        source_ref: '1',
        question: 'Which option is a synthetic example?',
        type: 'single_select',
        select_count: 1,
        classification: { area: 'Examples', topic: 'Synthetic data' },
        answers: [
          { text: 'Example A', correct: true },
          { text: 'Example B', correct: false },
        ],
      },
    ],
  }
}
