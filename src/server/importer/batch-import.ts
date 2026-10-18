import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { backup, DatabaseSync } from 'node:sqlite'
import type { Bank, Preview, Source } from '../../shared/contracts.ts'
import { LibraryRepository } from '../questions/library-repository.ts'
import { ImportService } from './import-service.ts'
import { validateBank } from './validate-bank.ts'

export type BatchResult = {
  sourceDirectory: string
  database: string
  applied: boolean
  files: { file: string; preview: Preview }[]
  sources: Source[]
}

/** Replay real service previews/confirms on an isolated snapshot, never the preview target. */
export async function importBatch(options: {
  sourceDirectory: string
  database: string
  files: readonly string[]
  apply?: boolean
}): Promise<BatchResult> {
  const sourceDirectory = resolve(options.sourceDirectory)
  const database = resolve(options.database)
  if (!options.files.length) throw new Error('Provide at least one bank file.')
  const identities = new Set<string>()
  const inputs = options.files.map((file) => {
    try {
      const path = resolve(sourceDirectory, file)
      if (statSync(path).size > 10 * 1024 * 1024)
        throw new Error('Bank exceeds the 10 MB import limit.')
      const bank = validateBank(JSON.parse(readFileSync(path, 'utf8')))
      const identity = JSON.stringify([
        bank.certification.provider,
        bank.certification.code,
        bank.source.key,
      ])
      if (identities.has(identity))
        throw new Error('Repeated source identity in batch; import each source only once.')
      identities.add(identity)
      return { file, bank }
    } catch (error) {
      throw fileError(file, error)
    }
  })
  const temporary = mkdtempSync(join(tmpdir(), 'study-import-preview-'))
  try {
    const snapshot = join(temporary, 'snapshot.sqlite3')
    if (existsSync(database)) {
      // SQLite's backup API includes committed WAL data and provides a consistent snapshot.
      const original = new DatabaseSync(database, { readOnly: true })
      try {
        await backup(original, snapshot)
      } finally {
        original.close()
      }
    }
    const simulated = new LibraryRepository(snapshot)
    let preview: BatchResult
    try {
      preview = run(simulated, inputs, sourceDirectory, database, false)
    } finally {
      simulated.close()
    }
    if (!options.apply) return preview
    mkdirSync(dirname(database), { recursive: true })
    const target = new LibraryRepository(database)
    try {
      return run(target, inputs, sourceDirectory, database, true)
    } finally {
      target.close()
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
}

function fileError(file: string, error: unknown): Error {
  return new Error(`${file}: ${error instanceof Error ? error.message : String(error)}`)
}

function run(
  repository: LibraryRepository,
  inputs: { file: string; bank: Bank }[],
  sourceDirectory: string,
  database: string,
  applied: boolean,
): BatchResult {
  return repository.transaction(() => {
    const service = new ImportService(repository)
    const files = inputs.map(({ file, bank }) => {
      try {
        const preview = service.preview(bank)
        // Never grant blanket review approval to existing content or metadata changes.
        service.confirm(bank, preview.token, false)
        return { file, preview }
      } catch (error) {
        throw fileError(file, error)
      }
    })
    return { sourceDirectory, database, applied, files, sources: repository.sources() }
  })
}
