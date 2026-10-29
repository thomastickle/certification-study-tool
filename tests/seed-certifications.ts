import { prepareRuntimeDatabase } from './managed-database-fixture.ts'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { LibraryRepository } from '../src/server/questions/library-repository.ts'
import { ImportService } from '../src/server/importer/import-service.ts'
import { bank } from './fixtures.ts'

const path = process.argv[2]
if (!path || existsSync(path)) {
  throw new Error('Provide a new disposable database path for certification fixtures.')
}
mkdirSync(dirname(resolve(path)), { recursive: true, mode: 0o700 })
prepareRuntimeDatabase(path)
const repository = new LibraryRepository(path)
const importer = new ImportService(repository)
for (const certification of [
  { provider: 'AWS', code: 'CLF-C02', name: 'Cloud Practitioner' },
  { provider: 'AWS', code: 'DEA-C01', name: 'Data Engineer – Associate' },
  { provider: 'Azure', code: 'AZ-900', name: 'Azure Fundamentals' },
  { provider: 'GCP', code: 'CDL', name: 'Cloud Digital Leader' },
]) {
  const input = bank(`synthetic-${certification.code}`)
  input.certification = certification
  input.questions = Array.from({ length: 80 }, (_, i) => ({
    ...input.questions[0]!,
    source_ref: String(i + 1),
    question: `${certification.code} synthetic question ${i + 1}?`,
    classification: { area: 'Cloud Concepts', topic: 'Cloud computing' },
  }))
  const preview = importer.preview(input)
  importer.confirm(input, preview.token, true)
}
repository.close()
