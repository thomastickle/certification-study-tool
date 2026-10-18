import { DatabaseSync } from 'node:sqlite'
import type { JsonObject, QuestionPage, Source, StoredQuestion } from '../../shared/contracts.ts'

export type SourceRecord = Omit<Source, 'questionCount'> & { metadata: JsonObject }

export type QuestionRecord = StoredQuestion & { fingerprint: string; answerKey: string }

/** SQLite access only. Application services own transactions. */
export class LibraryRepository {
  private db: DatabaseSync
  private transactionDepth = 0

  constructor(path: string) {
    this.db = new DatabaseSync(path, { timeout: 5000 })
    this.db.exec('PRAGMA foreign_keys = ON')
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
    if (version !== 0 && version !== 1) {
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
  }

  close(): void {
    this.db.close()
  }

  revision(): number {
    return Number(this.db.prepare('SELECT revision FROM library_state').get()?.revision)
  }

  transaction<T>(work: () => T): T {
    const depth = this.transactionDepth++
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
      this.transactionDepth--
    }
  }

  sources(): Source[] {
    return this.db
      .prepare(
        `SELECT s.id, s.name, s.kind, s.source_key AS key,
      s.provider, s.certification, s.certification_name AS certificationName,
      COUNT(q.id) AS questionCount FROM sources s LEFT JOIN questions q ON q.source_id = s.id
      GROUP BY s.id ORDER BY s.name, s.id`,
      )
      .all() as unknown as Source[]
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

  allQuestions(): QuestionRecord[] {
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
    })) as unknown as QuestionRecord[]
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
