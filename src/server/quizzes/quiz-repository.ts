import {
  initializeStudyEvidence,
  evidenceSavepoint,
  persistedStudyHistory,
  saveStudyEvidence,
} from './study-evidence.ts'
import { sameCertification } from './certification-scope.ts'
import type { CertificationScope } from './certification-scope.ts'
import { masteryHistory } from './mastery-history.ts'
import { completedQuestionIdentity } from './question-identity.ts'
import type { DatabaseSync } from 'node:sqlite'
import type { QuizSummary, QuizView } from '../../shared/quiz-contracts.ts'

export type StoredQuiz = QuizView & {
  keys: { fingerprint: string; correct: number[] }[]
  deletedAt?: number
  purgeAt?: number
}

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
  private accountId: string

  constructor(db: DatabaseSync, accountId = 'local') {
    this.db = db
    this.accountId = accountId
    initializeStudyEvidence(db)
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
    const row = this.db
      .prepare(
        `
      SELECT data FROM quiz_sessions
      WHERE account_id = ? AND id = ?
    `,
      )
      .get(this.accountId, id)
    return row ? JSON.parse(String(row.data)) : undefined
  }

  save(quiz: StoredQuiz): void {
    const data = JSON.stringify(quiz)
    evidenceSavepoint(this.db, () => {
      this.db
        .prepare(
          `INSERT INTO quiz_sessions(account_id, id, status, started_at, data)
         VALUES (?, ?, ?, ?, ?) ON CONFLICT(account_id, id) DO
        UPDATE SET status=excluded.status, data =excluded.data`,
        )
        .run(this.accountId, quiz.id, quiz.status, quiz.startedAt, data)
      if (quiz.status === 'completed') {
        saveStudyEvidence(this.db, this.accountId, JSON.parse(data))
      }
    })
  }

  /** Include unfinished and recoverable results when recording library provenance changes. */
  snapshots(): StoredQuiz[] {
    return this.db
      .prepare('SELECT data FROM quiz_sessions WHERE account_id = ?')
      .all(this.accountId)
      .map((row) => JSON.parse(String(row.data)))
  }

  /** Discard an unfinished snapshot without recording a result or changing mastery. */
  remove(id: string): void {
    this.db
      .prepare(
        `
      DELETE FROM quiz_sessions
      WHERE account_id = ? AND id = ?
    `,
      )
      .run(this.accountId, id)
  }

  /** Recoverable snapshots never participate in completed history queries. */
  deleted(): StoredQuiz[] {
    return this.db
      .prepare("SELECT data FROM quiz_sessions WHERE account_id = ? AND status = 'deleted'")
      .all(this.accountId)
      .map((row) => JSON.parse(String(row.data)))
  }

  /** Read only timer metadata; paused and completed attempts have no background deadline. */
  nextHousekeepingAt(): number | null {
    const row = this.db
      .prepare(
        `SELECT MIN(CASE status
                     WHEN 'active' THEN json_extract(data, '$.deadline')
                     WHEN 'deleted' THEN json_extract(data, '$.purgeAt')
                   END) AS deadline
         FROM quiz_sessions
         WHERE account_id = ? AND status IN ('active', 'deleted')`,
      )
      .get(this.accountId)
    return row?.deadline == null ? null : Number(row.deadline)
  }

  /** Remove expired snapshots, including after the application has been offline. */
  purgeDeleted(now: number): void {
    this.db
      .prepare(
        `DELETE FROM quiz_sessions
         WHERE account_id = ? AND status = 'deleted'
           AND json_extract(data, '$.purgeAt') <= ?`,
      )
      .run(this.accountId, now)
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
         WHERE account_id = ? AND status = 'completed'
         ORDER BY started_at DESC, id DESC`,
      )
      .all(this.accountId) as unknown as QuizSummary[]
  }

  /** Completed snapshots alone are eligible for aggregate reporting. */
  completed(): StoredQuiz[] {
    return this.db
      .prepare(
        `SELECT data FROM quiz_sessions
         WHERE account_id = ? AND status = 'completed'
         ORDER BY started_at DESC, id DESC`,
      )
      .all(this.accountId)
      .map((row) => JSON.parse(String(row.data)))
  }

  /** Replay validated compact events, recovering damaged or legacy rows from snapshots. */
  studyHistory(scope: CertificationScope = {}) {
    return (
      persistedStudyHistory(this.db, this.accountId, scope) ??
      masteryHistory(this.completed().filter((quiz) => sameCertification(quiz.options, scope)))
    )
  }

  active(): StoredQuiz[] {
    return this.db
      .prepare("SELECT data FROM quiz_sessions WHERE account_id = ? AND status='active'")
      .all(this.accountId)
      .map((row) => JSON.parse(String(row.data)))
  }

  /** Active and paused snapshots are recoverable without touching mastery. */
  unfinished(): StoredQuiz[] {
    return this.db
      .prepare(
        `SELECT data FROM quiz_sessions
         WHERE account_id = ? AND status IN ('active', 'paused')
         ORDER BY started_at DESC, id DESC`,
      )
      .all(this.accountId)
      .map((row) => JSON.parse(String(row.data)))
  }

  /** Compatibility query for historical callers; the old streak table is never authoritative. */
  boosts(): Set<string> {
    const completed = this.completed()
    const states = masteryHistory(completed).states
    return new Set(
      completed.flatMap((quiz) =>
        quiz.questions.flatMap((_, index) => {
          const identity = completedQuestionIdentity(quiz, index)
          const fingerprint = quiz.keys?.[index]?.fingerprint
          return identity && fingerprint && states.get(identity)?.boosted ? [fingerprint] : []
        }),
      ),
    )
  }

  /** Legacy table writer retained for compatibility; new scheduling never reads it. */
  record(fingerprint: string, correct: boolean): void {
    const previous = this.db
      .prepare(
        `
        SELECT boosted, correct_streak FROM quiz_mastery
        WHERE account_id = ? AND fingerprint = ?
      `,
      )
      .get(this.accountId, fingerprint)
    const streak = correct ? Number(previous?.correct_streak ?? 0) + 1 : 0
    const boosted = correct ? (previous?.boosted === 1 && streak < 3 ? 1 : 0) : 1
    this.db
      .prepare(
        `INSERT INTO quiz_mastery(account_id, fingerprint, boosted, correct_streak)
         VALUES (?, ?, ?, ?) ON CONFLICT(account_id, fingerprint) DO
        UPDATE SET boosted=excluded.boosted, correct_streak=excluded.correct_streak`,
      )
      .run(this.accountId, fingerprint, boosted, streak)
  }
}
