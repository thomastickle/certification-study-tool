import type { DatabaseSync } from 'node:sqlite'
import { ConceptRepository } from '../concepts/concept-repository.ts'
import { QuizRepository } from '../quizzes/quiz-repository.ts'
import {
  evidenceSavepoint,
  saveStudyEvidence,
  retainStudyEvidence,
} from '../quizzes/study-evidence.ts'
import { pinLegacySources } from './bank-provenance.ts'
import { sameCertification } from '../quizzes/certification-scope.ts'
import type { StoredQuiz } from '../quizzes/quiz-repository.ts'
import { CertificationRepository } from '../home/certification-repository.ts'
import type {
  JsonObject,
  LibraryItemId,
  QuestionPage,
  Source,
  StoredQuestion,
} from '../../shared/contracts.ts'
import { StudyLibrary } from './study-library.ts'
import { migratePrivateStudy } from './migrate-private-study.ts'
import { finishStudySeparation } from './study-separation.ts'
import { openLibraryDatabase } from './open-library-database.ts'
import type { LibraryOptions } from './open-library-database.ts'

export type SourceRecord = Omit<Source, 'questionCount' | 'id'> & {
  id: number
  metadata: JsonObject
}

export type QuestionRecord = Omit<StoredQuestion, 'id' | 'sourceId'> & {
  id: LibraryItemId
  sourceId: LibraryItemId
  fingerprint: string
  answerKey: string
}

type LocalQuestionRecord = QuestionRecord & { id: number; sourceId: number }

type LocalSource = Source & { id: number }

type DeletedBank = Pick<Source, 'name' | 'provider' | 'certification'> & {
  sourceId: LibraryItemId
}

type LegacyBankDeletion = {
  sources: LocalSource[]
  questions: LocalQuestionRecord[]
  source: LocalSource
}

type LibraryConnection = { db: DatabaseSync; transactionDepth: number; privateOwnerId?: string }

export type { LibraryOptions } from './open-library-database.ts'

/** Borrowed SQLite queries bound to one account; only the owning root can close the connection. */
export class LibraryView {
  private db: DatabaseSync
  private connection: LibraryConnection
  private accountId: string

  protected constructor(connection: LibraryConnection, accountId: string) {
    this.connection = connection
    this.db = connection.db
    this.accountId = accountId
  }

  /** Bind personal study stores to an authenticated account while sharing the content connection. */
  forAccount(accountId: string): LibraryView

  forAccount(accountId: string, privateLibrary: LibraryView): StudyLibrary

  forAccount(accountId: string, privateLibrary?: LibraryView): LibraryView | StudyLibrary {
    if (!accountId.trim()) {
      throw new Error('A study account ID is required.')
    }
    if (this.connection.privateOwnerId && this.connection.privateOwnerId !== accountId) {
      throw new Error('A private library cannot select another account’s study evidence.')
    }
    const progress = new LibraryView(this.connection, accountId)
    return privateLibrary
      ? new StudyLibrary(this, privateLibrary, privateLibrary.forAccount(accountId))
      : progress
  }

  /** Publish a shared deletion in the same transaction that removes its source. */
  recordSourceDeletion(source: LocalSource): void {
    this.db
      .prepare(
        `
      INSERT INTO deleted_sources(source_id, provider, certification, name, kind)
      VALUES (?, ?, ?, ?, ?)
    `,
      )
      .run(source.id, source.provider, source.certification, source.name, source.kind)
  }

  deletedSourcesAfter(sequence: number) {
    return this.db
      .prepare(
        `
      SELECT sequence, source_id AS sourceId, provider, certification, name, kind
      FROM deleted_sources
      WHERE sequence > ?
      ORDER BY sequence
    `,
      )
      .all(sequence) as {
      sequence: number
      sourceId: number
      provider: string
      certification: string
      name: string
      kind: string
    }[]
  }

  sharedDeletionCursor(): number {
    return Number(
      this.db.prepare('SELECT sequence FROM shared_deletion_cursor WHERE singleton = 1').get()
        ?.sequence,
    )
  }

  saveSharedDeletionCursor(sequence: number): void {
    this.db
      .prepare('UPDATE shared_deletion_cursor SET sequence = ? WHERE singleton = 1')
      .run(sequence)
  }

  /** Expiry and retention jobs visit only accounts with unfinished timer or deletion work. */
  pendingStudyAccounts(): string[] {
    return this.db
      .prepare(
        `
      SELECT DISTINCT account_id
      FROM quiz_sessions
      WHERE status IN ('active', 'deleted')
    `,
      )
      .all()
      .map((row) => String(row.account_id))
  }

  /** Annotate shared-bank provenance across accounts without returning personal snapshots to callers. */
  annotateSnapshots(annotate: (quiz: StoredQuiz) => boolean): void {
    this.updateSnapshots(annotate, false)
  }

  /** Only this owned mutation may reuse evidence: source IDs and labels are not extraction inputs. */
  annotateDeletedBanks(events: DeletedBank[], legacy?: LegacyBankDeletion): void {
    this.updateSnapshots((quiz) => {
      const resolvedLegacy =
        legacy && sameCertification(quiz.options, legacy.source)
          ? pinLegacySources(quiz, legacy.sources, legacy.questions, legacy.source)
          : false
      const names = events
        .filter(
          (event) =>
            sameCertification(quiz.options, event) &&
            quiz.questions.some((question) => question.sourceId === event.sourceId),
        )
        .map((event) => event.name)
      if (names.length) {
        quiz.deletedBankNames = [...new Set([...(quiz.deletedBankNames ?? []), ...names])]
      }
      return resolvedLegacy || names.length > 0
    }, true)
  }

  /** Generic callbacks always rebuild; only the repository-owned provenance mutation can retain. */
  private updateSnapshots(annotate: (quiz: StoredQuiz) => boolean, provenanceOnly: boolean): void {
    // Own the write lock before reading snapshots so retained evidence shares the same view.
    // QuizRepository callers also own transactions outside the library depth counter.
    const annotateRecords = () => {
      const records = this.db
        .prepare('SELECT account_id, id, status, data FROM quiz_sessions')
        .all()
      const update = this.db.prepare(
        'UPDATE quiz_sessions SET data = ? WHERE account_id = ? AND id = ?',
      )
      for (const record of records) {
        const quiz: StoredQuiz = JSON.parse(String(record.data))
        if (annotate(quiz)) {
          const data = JSON.stringify(quiz)
          evidenceSavepoint(this.db, () => {
            const restore =
              provenanceOnly && record.status === 'completed'
                ? retainStudyEvidence(this.db, String(record.account_id), String(record.id))
                : undefined
            update.run(data, record.account_id!, record.id!)
            if (record.status === 'completed' && !restore?.()) {
              saveStudyEvidence(
                this.db,
                String(record.account_id),
                JSON.parse(data),
                String(record.id),
              )
            }
          })
        }
      }
    }

    if (this.db.isTransaction) {
      evidenceSavepoint(this.db, annotateRecords)
    } else {
      this.transaction(annotateRecords)
    }
  }

  certificationStore(): CertificationRepository {
    return new CertificationRepository(this.db, this.accountId)
  }

  conceptStore(): ConceptRepository {
    return new ConceptRepository(this.db)
  }

  /** Study selection reads mappings without gaining access to concept mutation methods. */
  reviewedConcepts() {
    return this.conceptStore().all()
  }

  quizStore(): QuizRepository {
    return new QuizRepository(this.db, this.accountId)
  }

  revision(): number {
    return Number(this.db.prepare('SELECT revision FROM library_state').get()?.revision)
  }

  transaction<T>(work: () => T): T {
    const depth = this.connection.transactionDepth++
    const savepoint = `library_${depth}`
    try {
      this.db.exec(depth === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${savepoint}`)
      try {
        const result = work()
        if (depth === 0) this.db.exec('UPDATE library_state SET revision = revision + 1; COMMIT')
        else this.db.exec(`RELEASE ${savepoint}`)
        return result
      } catch (error) {
        this.db.exec(depth === 0 ? 'ROLLBACK' : `ROLLBACK TO ${savepoint}; RELEASE ${savepoint}`)
        throw error
      }
    } finally {
      this.connection.transactionDepth--
    }
  }

  sources(): LocalSource[] {
    return this.db
      .prepare(
        `SELECT s.id, s.name, s.kind, s.source_key AS key,
      s.provider, s.certification, s.certification_name AS certificationName,
      COUNT(q.id) AS questionCount FROM sources s LEFT JOIN questions q ON q.source_id = s.id
      GROUP BY s.id ORDER BY s.name, s.id`,
      )
      .all() as unknown as LocalSource[]
  }

  source(provider: string, certification: string, key: string): SourceRecord | undefined {
    const row = this.db
      .prepare(
        `SELECT s.id, s.name, s.kind, s.source_key AS key,
      s.provider, s.certification, s.certification_name AS certificationName,
      s.metadata FROM sources s WHERE provider = ? AND certification = ? AND source_key = ?`,
      )
      .get(provider, certification, key)
    if (!row) return undefined
    return { ...row, metadata: JSON.parse(String(row.metadata)) } as unknown as SourceRecord
  }

  saveSource(
    provider: string,
    certification: string,
    certificationName: string,
    key: string,
    name: string,
    kind: string,
    metadata: string,
  ): number {
    this.db
      .prepare(
        `INSERT INTO sources(provider, certification, certification_name, source_key, name, kind, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(provider, certification, source_key) DO UPDATE SET
      certification_name = excluded.certification_name, name = excluded.name,
      kind = excluded.kind, metadata = excluded.metadata`,
      )
      .run(provider, certification, certificationName, key, name, kind, metadata)
    return this.source(provider, certification, key)!.id
  }

  allQuestions(): LocalQuestionRecord[] {
    const rows = this.db
      .prepare(
        `SELECT q.id, q.source_id AS sourceId, s.name AS sourceName,
      q.reference, q.data, q.fingerprint, q.answer_key AS answerKey
      FROM questions q JOIN sources s ON s.id = q.source_id ORDER BY q.id`,
      )
      .all()
    return rows.map((row) => ({
      ...row,
      data: JSON.parse(String(row.data)),
    })) as unknown as LocalQuestionRecord[]
  }

  questions(sourceId?: number, search = '', page = 1): QuestionPage {
    // This initial local library is small; filtering here keeps paging consistent with detail objects.
    const matching = this.allQuestions().filter(
      (q) =>
        (!sourceId || q.sourceId === sourceId) &&
        [
          q.data.question,
          q.reference,
          q.data.classification?.area,
          q.data.classification?.topic,
        ].some((value) => value?.toLowerCase().includes(search.toLowerCase())),
    )
    return {
      items: matching.slice((page - 1) * 25, page * 25),
      total: matching.length,
      page,
      pageSize: 25,
    }
  }

  saveQuestion(
    sourceId: number,
    reference: string,
    data: string,
    fingerprint: string,
    answerKey: string,
  ): void {
    this.db
      .prepare(
        `INSERT INTO questions(source_id, reference, data, fingerprint, answer_key) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(source_id, reference) DO UPDATE SET data = excluded.data,
      fingerprint = excluded.fingerprint, answer_key = excluded.answer_key`,
      )
      .run(sourceId, reference, data, fingerprint, answerKey)
  }

  deleteQuestion(id: number): boolean {
    return this.db.prepare('DELETE FROM questions WHERE id = ?').run(id).changes === 1
  }

  deleteSource(id: number): boolean {
    return this.db.prepare('DELETE FROM sources WHERE id = ?').run(id).changes === 1
  }
}

/** Own one initialized SQLite connection; request/account views borrow it without a close capability. */
export class LibraryRepository extends LibraryView {
  private ownedDatabase: DatabaseSync
  private closed = false

  constructor(path: string, accountId = 'local', options: LibraryOptions = {}) {
    const db = openLibraryDatabase(path, accountId, options)
    super({ db, transactionDepth: 0, privateOwnerId: options.privateOwnerId }, accountId)
    this.ownedDatabase = db
  }

  /** Release the root's connection once, invalidating all of its borrowed views. */
  close(): void {
    if (!this.closed) {
      this.ownedDatabase.close()
      this.closed = true
    }
  }

  /** Find only owners with pending migration, not all accounts registered with the identity provider. */
  studyAccounts(): string[] {
    return this.ownedDatabase
      .prepare(
        `
      SELECT account_id FROM quiz_sessions
      UNION SELECT account_id FROM quiz_mastery
      UNION SELECT account_id FROM earned_certifications
    `,
      )
      .all()
      .map((row) => String(row.account_id))
  }

  /** Transfer one account's study evidence before serving any requests against the new layout. */
  moveStudyTo(destination: string, accountId: string): void {
    migratePrivateStudy(this.ownedDatabase, destination, accountId)
  }

  /** Startup must finish shared-file byte cleanup even when all owner transfers already committed. */
  finishStudyMigration(): void {
    finishStudySeparation(this.ownedDatabase)
  }
}
