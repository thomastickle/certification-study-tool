import type { JsonObject, Preview } from '../../shared/contracts.ts'
import { LibraryRepository } from '../questions/library-repository.ts'
import { ApplicationError } from '../errors.ts'
import { validateBank } from './validate-bank.ts'
import { answerKey, canonical, digest, fingerprint, reference } from './bank-tools.ts'

/** File import use cases; no HTTP, UI or filesystem ownership. */
export class ImportService {
  private repository: LibraryRepository
  constructor(repository: LibraryRepository) {
    this.repository = repository
  }

  preview(input: unknown): Preview {
    const bank = validateBank(input)
    const source = this.repository.source(
      bank.certification.provider,
      bank.certification.code,
      bank.source.key,
    )
    const existing = new Map(
      this.repository
        .allQuestions()
        .filter((q) => q.sourceId === source?.id)
        .map((q) => [q.reference, q]),
    )
    const preview: Preview = {
      token: digest([bank, this.repository.revision()]),
      sourceName: bank.source.name,
      sourceKind: bank.source.type,
      certification: bank.certification.code,
      total: bank.questions.length,
      added: 0,
      unchanged: 0,
      changed: [],
      metadataChange: null,
      duplicateCount: 0,
      conflicts: [],
      unclassified: [],
    }
    for (const question of bank.questions) {
      const old = existing.get(reference(question))
      if (!old) preview.added++
      else if (canonical(old.data) === canonical(question)) preview.unchanged++
      else
        preview.changed.push({ reference: reference(question), before: old.data, after: question })
    }
    const { questions: _questions, ...metadata } = bank
    if (source && canonical(source.metadata) !== canonical(metadata)) {
      preview.metadataChange = { before: source.metadata, after: metadata }
    }
    const incomingRefs = new Set(bank.questions.map(reference))
    // Evaluate duplicates against the proposed final library, excluding replaced versions.
    const others = this.repository
      .allQuestions()
      .filter((q) => q.sourceId !== source?.id || !incomingRefs.has(q.reference))
    const incoming = bank.questions.map((q) => ({
      reference: reference(q),
      fingerprint: fingerprint(q),
      answerKey: answerKey(q),
    }))
    const groups = new Map<string, { count: number; answerKeys: Set<string> }>()
    for (const question of [...others, ...incoming]) {
      const group = groups.get(question.fingerprint) ?? { count: 0, answerKeys: new Set<string>() }
      group.count++
      group.answerKeys.add(question.answerKey)
      groups.set(question.fingerprint, group)
    }
    for (const question of incoming) {
      const group = groups.get(question.fingerprint)!
      if (group.count > 1) preview.duplicateCount++
      if (group.answerKeys.size > 1) preview.conflicts.push(question.reference)
    }
    preview.unclassified = bank.questions.filter((q) => !q.classification).map(reference)
    return preview
  }

  confirm(input: unknown, token: string, reviewed: boolean): Preview {
    return this.repository.transaction(() => {
      const preview = this.preview(input)
      if (token !== preview.token)
        throw new ApplicationError(
          'The library or file changed. Preview again before importing.',
          409,
        )
      if ((preview.changed.length || preview.metadataChange) && !reviewed) {
        throw new ApplicationError(
          'Review the changed questions and source metadata before importing.',
          409,
        )
      }
      if (preview.conflicts.length) {
        throw new ApplicationError(
          'Conflicting answer keys must be corrected in the file before importing.',
          409,
          preview.conflicts,
        )
      }
      const bank = validateBank(input)
      const { questions, ...metadata } = bank
      const sourceId = this.repository.saveSource(
        bank.certification.provider,
        bank.certification.code,
        bank.certification.name,
        bank.source.key,
        bank.source.name,
        bank.source.type,
        canonical(metadata as JsonObject),
      )
      const existing = new Map(
        this.repository
          .allQuestions()
          .filter((q) => q.sourceId === sourceId)
          .map((q) => [q.reference, canonical(q.data)]),
      )
      for (const question of questions) {
        if (existing.get(reference(question)) === canonical(question)) continue
        this.repository.saveQuestion(
          sourceId,
          reference(question),
          canonical(question),
          fingerprint(question),
          answerKey(question),
        )
      }
      return preview
    })
  }
}
