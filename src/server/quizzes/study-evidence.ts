import { createHash } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { StoredQuiz } from './quiz-repository.ts'
import { certificationScope } from './certification-scope.ts'
import type { CertificationScope } from './certification-scope.ts'
import { completedQuestionIdentity } from './question-identity.ts'
import { evidenceWithIdentity } from './mastery-history.ts'
import { replayMastery } from './mastery.ts'
import type { MasteryEvidence } from './mastery.ts'

// Bump for any change to identity validation, scoring extraction, or this wire format.
// Mastery rules are deliberately not cached: every read runs the current replay rules.
const evidenceVersion = 1

type Encounter = [
  identity: string,
  answered: boolean,
  correct: boolean,
  confidence: MasteryEvidence['confidence'],
  unknown: boolean,
]

type AttemptEvidence = { attemptId: string; at: number | null; encounters: Encounter[] }

type EvidenceRow = {
  id: string
  version: number
  provider: string | null
  certification: string | null
  payload: string
  checksum: string
}

/** Bind the small derived payload to its owner, attempt, scope and extraction version. */
function checksum(accountId: string, row: Omit<EvidenceRow, 'checksum'>): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        accountId,
        row.id,
        row.version,
        row.provider,
        row.certification,
        row.payload,
      ]),
    )
    .digest('hex')
}

/** Extract scoring once; preserve malformed legacy snapshots for authoritative fallback on reads. */
export function saveStudyEvidence(
  db: DatabaseSync,
  accountId: string,
  quiz: StoredQuiz,
  id = quiz.id,
): void {
  let provider: string | null = null
  let certification: string | null = null
  let payload = 'null'
  try {
    const scope = certificationScope(quiz.options)
    provider = scope.provider
    certification = scope.certification
    const encounters: Encounter[] = []
    quiz.questions.forEach((_, index) => {
      const identity = completedQuestionIdentity(quiz, index)
      if (!identity) {
        return
      }
      const event = evidenceWithIdentity(quiz, index, identity)
      encounters.push([
        identity,
        event?.answered ?? false,
        event?.correct ?? false,
        event?.confidence ?? null,
        event === null,
      ])
    })
    payload = JSON.stringify({
      attemptId: quiz.id,
      at: Number.isFinite(quiz.finishedAt) ? quiz.finishedAt : null,
      encounters,
    } satisfies AttemptEvidence)
  } catch {
    // Saving malformed historical snapshots was legal before projections existed.
    // A sentinel makes the read use the original validation/error path, never an empty summary.
  }
  const row = { id, version: evidenceVersion, provider, certification, payload }
  db.prepare(
    `
    INSERT OR REPLACE INTO quiz_evidence
      (account_id, id, version, provider, certification, payload, checksum)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(accountId, row.id, row.version, provider, certification, payload, checksum(accountId, row))
}

/** Preserve the caller's transaction, including when a standalone repository method owns none. */
export function evidenceSavepoint<T>(db: DatabaseSync, work: () => T): T {
  db.exec('SAVEPOINT study_evidence')
  try {
    const value = work()
    db.exec('RELEASE study_evidence')
    return value
  } catch (error) {
    db.exec('ROLLBACK TO study_evidence; RELEASE study_evidence')
    throw error
  }
}

/** Validate corruption before trusting a projection; snapshot writes are guarded by SQL triggers. */
function decode(accountId: string, row: EvidenceRow): AttemptEvidence | null | undefined {
  if (row.version !== evidenceVersion || checksum(accountId, row) !== row.checksum) {
    return undefined
  }
  try {
    return JSON.parse(row.payload) as AttemptEvidence | null
  } catch {
    return undefined
  }
}

/**
 * Capture a checksum/version-validated row for reinsertion after an owned provenance-only write.
 * The caller must prove extraction inputs unchanged and enclose capture/write/restore in a savepoint.
 * Invalid or missing rows return no restorer so the caller rebuilds immediately from the snapshot.
 */
export function retainStudyEvidence(db: DatabaseSync, accountId: string, id: string) {
  const row = db
    .prepare(
      `
      SELECT id, version, provider, certification, payload, checksum
      FROM quiz_evidence WHERE account_id = ? AND id = ?
    `,
    )
    .get(accountId, id) as EvidenceRow | undefined
  if (!row || decode(accountId, row) === undefined) {
    return undefined
  }
  return () => {
    db.prepare(
      `
      INSERT INTO quiz_evidence
        (account_id, id, version, provider, certification, payload, checksum)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    ).run(
      accountId,
      row.id,
      row.version,
      row.provider,
      row.certification,
      row.payload,
      row.checksum,
    )
    return true
  }
}

/**
 * Rebuild only missing/stale rows, then replay compact evidence in the selected exact namespace.
 * Returns null for legacy evidence that must use the original snapshot replay/error boundary.
 * @throws {Error} On SQLite or authoritative JSON failures; the rebuild rolls back atomically.
 */
export function persistedStudyHistory(
  db: DatabaseSync,
  accountId: string,
  scope: CertificationScope,
) {
  const selected = certificationScope(scope)
  return evidenceSavepoint(db, () => {
    const missing = db
      .prepare(
        `
      SELECT q.id, q.data FROM quiz_sessions q
      LEFT JOIN quiz_evidence e ON e.account_id = q.account_id AND e.id = q.id
      WHERE q.account_id = ? AND q.status = 'completed'
        AND (e.id IS NULL OR e.version != ?)
    `,
      )
      .all(accountId, evidenceVersion)
    for (const row of missing) {
      saveStudyEvidence(db, accountId, JSON.parse(String(row.data)), String(row.id))
    }
    // Check integrity before scope filtering: corrupt scope metadata must never hide obligations.
    // Invalid scope historically throws even if another certification was requested.
    const rows = db
      .prepare(
        `
      SELECT e.id, e.version, e.provider, e.certification, e.payload, e.checksum
      FROM quiz_evidence e
      JOIN quiz_sessions q ON q.account_id = e.account_id AND q.id = e.id
      WHERE e.account_id = ? AND q.status = 'completed'
      ORDER BY q.started_at DESC, q.id DESC
    `,
      )
      .all(accountId) as EvidenceRow[]
    const events: MasteryEvidence[] = []
    const recency = new Map<string, number>()
    for (let row of rows) {
      let attempt = decode(accountId, row)
      if (attempt === undefined) {
        const original = db
          .prepare(
            `
          SELECT data FROM quiz_sessions WHERE account_id = ? AND id = ?
        `,
          )
          .get(accountId, row.id)!
        saveStudyEvidence(db, accountId, JSON.parse(String(original.data)), row.id)
        row = db
          .prepare(
            `
          SELECT id, version, provider, certification, payload, checksum
          FROM quiz_evidence WHERE account_id = ? AND id = ?
        `,
          )
          .get(accountId, row.id) as EvidenceRow
        attempt = decode(accountId, row)
      }
      if (row.provider === null) {
        return null
      }
      if (row.provider !== selected.provider || row.certification !== selected.certification) {
        continue
      }
      if (!attempt) {
        return null
      }
      for (const [identity, answered, correct, confidence, unknown] of attempt.encounters) {
        if (attempt.at !== null) {
          recency.set(identity, Math.max(recency.get(identity) ?? -Infinity, attempt.at))
        }
        events.push({
          identity,
          attemptId: attempt.attemptId,
          at: attempt.at ?? -Infinity,
          answered,
          correct,
          confidence,
          ...(unknown ? { unknown: true } : {}),
        })
      }
    }
    return { states: replayMastery(events), recency }
  })
}
