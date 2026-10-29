import { prepareRuntimeDatabase } from './managed-database-fixture.ts'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { HomeService } from '../src/server/home/home-service.ts'
import { ImportService } from '../src/server/importer/import-service.ts'
import { LibraryRepository } from '../src/server/questions/library-repository.ts'
import { homeExam, homeNow } from './home-fixtures.ts'
import { populate } from './quiz-fixtures.ts'
import { bank } from './fixtures.ts'

const database = process.argv[2]
if (!database || existsSync(database)) {
  throw new Error('Provide a new disposable database path for synthetic Home fixtures.')
}
mkdirSync(dirname(resolve(database)), { recursive: true, mode: 0o700 })
prepareRuntimeDatabase(database)
const repository = new LibraryRepository(database)
try {
  populate(repository, 50)
  const importer = new ImportService(repository)
  for (const [provider, code, name] of [
    ['AWS', 'DEMO-DE', 'Data Engineer (synthetic)'],
    ['AWS', 'DEMO-SA', 'Solutions Architect (synthetic)'],
    ['Other Provider', 'DEMO-1', 'Another certification (synthetic)'],
  ]) {
    const input = bank(code)
    input.certification = { provider: provider!, code: code!, name: name! }
    importer.confirm(input, importer.preview(input).token, false)
  }
  const offset = Date.now() - homeNow
  for (const age of [3, 2, 1]) {
    const exam = homeExam(`00000000-0000-4000-8000-00000000000${age}`, age)
    exam.startedAt += offset
    exam.deadline += offset
    exam.finishedAt! += offset
    exam.serverNow += offset
    repository.quizStore().save(exam)
  }
  new HomeService(repository).setEarned({ provider: 'AWS', code: 'CLF-C02', earned: true })
} finally {
  repository.close()
}
