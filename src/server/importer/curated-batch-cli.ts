import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { importBatch } from './batch-import.ts'
import { validateBank } from './validate-bank.ts'

const files = [
  ['01_official/aws-clf-c02-official-practice-exam-2026(2).json', 65, 'official'],
  ['01_official/aws-clf-c02-official-practice-question-set-2026(2).json', 20, 'official'],
  ['01_official/aws-clf-c02-official-pretest-2026(2).json', 65, 'official'],
  ['02_screened/aws_screened_cloudcertprep_2026.json', 942, 'third_party'],
  ['02_screened/aws_screened_github_additions_2026.json', 41, 'third_party'],
] as const

try {
  const { values } = parseArgs({
    options: {
      source: { type: 'string' },
      db: { type: 'string' },
      apply: { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  })
  if (values.help) {
    console.log(
      'npm run import:curated -- --source <bundle-directory> --db <database> [--dry-run | --apply]',
    )
  } else {
    if (!values.source || !values.db)
      throw new Error(
        'Explicit --source and --db paths are required. No default library is selected.',
      )
    if (values.apply && values['dry-run']) throw new Error('Choose --dry-run or --apply, not both.')
    const sourceDirectory = resolve(values.source)
    const database = resolve(values.db)
    console.log(
      JSON.stringify({ mode: values.apply ? 'apply' : 'dry-run', sourceDirectory, database }),
    )
    // Bundle-specific guardrails, in addition to the actual importer validation.
    for (const [file, count, type] of files) {
      try {
        const bank = validateBank(JSON.parse(readFileSync(resolve(sourceDirectory, file), 'utf8')))
        if (
          bank.certification.provider !== 'AWS' ||
          bank.certification.code !== 'CLF-C02' ||
          bank.questions.length !== count ||
          bank.source.type !== type
        ) {
          throw new Error(`Expected AWS CLF-C02, ${count} questions and source type ${type}.`)
        }
        if (type === 'third_party' && bank.source.verification_status !== 'unverified')
          throw new Error('Screened third-party source must remain unverified.')
      } catch (error) {
        throw new Error(`${file}: ${error instanceof Error ? error.message : String(error)}`, {
          cause: error,
        })
      }
    }
    const result = await importBatch({
      sourceDirectory,
      database,
      files: files.map(([file]) => file),
      apply: values.apply,
    })
    // Output counts and references, never private question text or answer content.
    console.log(
      JSON.stringify(
        {
          ...result,
          files: result.files.map(({ file, preview }) => ({
            file,
            total: preview.total,
            added: preview.added,
            unchanged: preview.unchanged,
            duplicateOccurrences: preview.duplicateCount,
            conflicts: preview.conflicts,
            changed: preview.changed.map((c) => c.reference),
            metadataChanged: Boolean(preview.metadataChange),
            unclassified: preview.unclassified,
          })),
        },
        null,
        2,
      ),
    )
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
