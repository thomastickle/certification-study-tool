import { DatabaseSync } from 'node:sqlite'
import { ConceptRepository, migrateConcepts } from '../concepts/concept-repository.ts'
import { migrateQuizzes, QuizRepository } from '../quizzes/quiz-repository.ts'
import type { StoredQuiz } from '../quizzes/quiz-repository.ts'
import { CertificationRepository, migrateCertifications } from '../home/certification-repository.ts'
import type {
  JsonObject,
  LibraryItemId,
  QuestionPage,
  Source,
  StoredQuestion,
} from '../../shared/contracts.ts'
import { migrateStudyOwnership } from './study-schema.ts'
import { StudyLibrary } from './study-library.ts'
import { migrateLibraryVisibility } from './library-visibility-schema.ts'
import { migratePrivateStudy } from './migrate-private-study.ts'

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

type LibraryConnection = { db: DatabaseSync; transactionDepth: number; privateOwnerId?: string }

export type LibraryOptions = { legacyOwnerId?: string; privateOwnerId?: string }

/** SQLite access only. Application services own transactions. */
export class LibraryRepository {
  private db: DatabaseSync
  private connection: LibraryConnection
  private ownsConnection: boolean
  private accountId: string

  constructor(path: string | LibraryConnection, accountId = 'local', options: LibraryOptions = {}) {
    this.accountId = accountId
    this.ownsConnection = typeof path === 'string'
    if (typeof path !== 'string') {
      this.connection = path
      this.db = path.db
      return
    }
    this.db = new DatabaseSync(path, { timeout: 5000 })
    this.connection = { db: this.db, transactionDepth: 0, privateOwnerId: options.privateOwnerId }
    this.db.exec('PRAGMA foreign_keys = ON')
    const privateMarker = this.db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'private_library_owner'",
      )
      .get()
    if (privateMarker || options.privateOwnerId) {
      try {
        if (!options.privateOwnerId || options.privateOwnerId !== accountId) {
          throw new Error('A private library cannot be opened as the shared library.')
        }
        const owner = this.db
          .prepare('SELECT account_id FROM private_library_owner WHERE singleton = 1')
          .get()
        if (owner?.account_id !== options.privateOwnerId) {
          throw new Error('Private library owner does not match the selected account.')
        }
      } catch (error) {
        this.db.close()
        throw error
      }
    }
    const version = this.db.prepare('PRAGMA user_version').get()?.user_version
    const appId = this.db.prepare('PRAGMA application_id').get()?.application_id
    const occupied =
      Number(
        this.db
          .prepare(
            "SELECT count(*) AS total FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
          )
          .get()?.total,
      ) > 0
    if ((version === 0 && occupied) || (version !== 0 && appId !== 1096242004)) {
      this.db.close()
      throw new Error('Unrecognized database. Use a separate application database.')
    }
    if (version !== 0 && version !== 1 && version !== 2 && version !== 3 && version !== 4) {
      this.db.close()
      throw new Error('Unsupported database version. Use a separate application database.')
    }
    if (version === 0)
      this.db.exec(`
      BEGIN;
      CREATE TABLE library_state (id INTEGER PRIMARY KEY CHECK (id = 1), revision INTEGER NOT NULL);
      INSERT INTO library_state VALUES (1, 0);
      CREATE TABLE sources (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        provider TEXT NOT NULL, certification TEXT NOT NULL, certification_name TEXT NOT NULL,
        source_key TEXT NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL, metadata TEXT NOT NULL,
        UNIQUE(provider, certification, source_key)
      );
      CREATE TABLE questions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_id INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
        reference TEXT NOT NULL, data TEXT NOT NULL,
        fingerprint TEXT NOT NULL, answer_key TEXT NOT NULL,
        UNIQUE(source_id, reference)
      );
      CREATE INDEX questions_fingerprint ON questions(fingerprint);
      PRAGMA application_id = 1096242004;
      PRAGMA user_version = 1;
      COMMIT;
    `)
    try {
      migrateQuizzes(this.db)
      migrateConcepts(this.db)
      migrateCertifications(this.db)
      migrateStudyOwnership(this.db, options.legacyOwnerId)
      migrateLibraryVisibility(this.db)
    } catch (error) {
      this.db.close()
      throw error
    }
  }

  /** Bind personal study stores to an authenticated account while sharing the content connection. */
  forAccount(accountId: string): LibraryRepository

  forAccount(accountId: string, privateLibrary: LibraryRepository): StudyLibrary

  forAccount(
    accountId: string,
    privateLibrary?: LibraryRepository,
  ): LibraryRepository | StudyLibrary {
    if (!accountId.trim()) {
      throw new Error('A study account ID is required.')
    }
    if (this.connection.privateOwnerId && this.connection.privateOwnerId !== accountId) {
      throw new Error('A private library cannot select another account’s study evidence.')
    }
    const progress = new LibraryRepository(this.connection, accountId)
    return privateLibrary
      ? new StudyLibrary(this, privateLibrary, privateLibrary.forAccount(accountId))
      : progress
  }

  /** Find only owners with pending migration, not all accounts registered with the identity provider. */
  studyAccounts(): string[] {
    return this.db
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
    migratePrivateStudy(this.db, destination, accountId)
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
    const records = this.db.prepare('SELECT account_id, id, data FROM quiz_sessions').all()
    const update = this.db.prepare(
      'UPDATE quiz_sessions SET data = ? WHERE account_id = ? AND id = ?',
    )
    for (const record of records) {
      const quiz: StoredQuiz = JSON.parse(String(record.data))
      if (annotate(quiz)) {
        update.run(JSON.stringify(quiz), record.account_id!, record.id!)
      }
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

  close(): void {
    if (this.ownsConnection) {
      this.db.close()
    }
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
