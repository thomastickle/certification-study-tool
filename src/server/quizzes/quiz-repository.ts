import type { DatabaseSync } from 'node:sqlite'
import type { QuizSummary, QuizView } from '../../shared/quiz-contracts.ts'

export type StoredQuiz = QuizView & { keys: { fingerprint: string; correct: number[] }[] }

export function migrateQuizzes(db: DatabaseSync): void {
  if (Number(db.prepare('PRAGMA user_version').get()?.user_version) !== 1) return
  db.exec(`BEGIN IMMEDIATE;
    CREATE TABLE quiz_sessions (id TEXT PRIMARY KEY, status TEXT NOT NULL, started_at INTEGER NOT NULL, data TEXT NOT NULL);
    CREATE TABLE quiz_mastery (fingerprint TEXT PRIMARY KEY, boosted INTEGER NOT NULL, correct_streak INTEGER NOT NULL);
    PRAGMA user_version = 2;
    COMMIT;`)
}

/** Snapshot storage has no cascading source/question FKs: old results survive library deletion. */
export class QuizRepository {
  private db: DatabaseSync

  constructor(db: DatabaseSync) {
    this.db = db
  }

  transaction<T>(work: () => T): T {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const value = work()
      this.db.exec('COMMIT')
      return value
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  find(id: string): StoredQuiz | undefined {
    const row = this.db.prepare('SELECT data FROM quiz_sessions WHERE id = ?').get(id)
    return row ? JSON.parse(String(row.data)) : undefined
  }

  save(quiz: StoredQuiz): void {
    this.db
      .prepare(
        `INSERT INTO quiz_sessions(id, status, started_at, data)
         VALUES (?, ?, ?, ?) ON CONFLICT(id) DO
        UPDATE SET status=excluded.status, data =excluded.data`,
      )
      .run(quiz.id, quiz.status, quiz.startedAt, JSON.stringify(quiz))
  }

  /** Discard an unfinished snapshot without recording a result or changing mastery. */
  remove(id: string): void {
    this.db.prepare('DELETE FROM quiz_sessions WHERE id = ?').run(id)
  }

  recent(): QuizSummary[] {
    return this.db
      .prepare(
        `SELECT id,
                status,
                started_at                                             AS startedAt,
                COALESCE(json_extract(data, '$.options.mode'), 'quiz') AS mode,
                json_extract(data, '$.deadline')                       AS deadline,
                json_extract(data, '$.finishedAt')                     AS finishedAt,
                json_extract(data, '$.correctCount')                   AS correctCount,
                json_extract(data, '$.total')                          AS total
         FROM quiz_sessions
         WHERE status = 'completed'
         ORDER BY started_at DESC, id DESC`,
      )
      .all() as unknown as QuizSummary[]
  }

  /** Completed snapshots alone are eligible for aggregate reporting. */
  completed(): StoredQuiz[] {
    return this.db
      .prepare(
        "SELECT data FROM quiz_sessions WHERE status='completed' ORDER BY started_at DESC, id DESC",
      )
      .all()
      .map((row) => JSON.parse(String(row.data)))
  }

  active(): StoredQuiz[] {
    return this.db
      .prepare("SELECT data FROM quiz_sessions WHERE status='active'")
      .all()
      .map((row) => JSON.parse(String(row.data)))
  }

  /** Active and paused snapshots are recoverable without touching mastery. */
  unfinished(): StoredQuiz[] {
    return this.db
      .prepare(
        "SELECT data FROM quiz_sessions WHERE status IN ('active', 'paused') ORDER BY started_at DESC, id DESC",
      )
      .all()
      .map((row) => JSON.parse(String(row.data)))
  }

  boosts(): Set<string> {
    return new Set(
      this.db
        .prepare('SELECT fingerprint FROM quiz_mastery WHERE boosted = 1')
        .all()
        .map((row) => String(row.fingerprint)),
    )
  }

  record(fingerprint: string, correct: boolean): void {
    const previous = this.db
      .prepare('SELECT boosted, correct_streak FROM quiz_mastery WHERE fingerprint = ?')
      .get(fingerprint)
    const streak = correct ? Number(previous?.correct_streak ?? 0) + 1 : 0
    const boosted = correct ? (previous?.boosted === 1 && streak < 3 ? 1 : 0) : 1
    this.db
      .prepare(
        `INSERT INTO quiz_mastery(fingerprint, boosted, correct_streak)
         VALUES (?, ?, ?) ON CONFLICT(fingerprint) DO
        UPDATE SET boosted=excluded.boosted, correct_streak=excluded.correct_streak`,
      )
      .run(fingerprint, boosted, streak)
  }
}
