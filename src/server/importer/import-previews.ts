import { randomBytes } from 'node:crypto'
import { ApplicationError } from '../errors.ts'

type PendingPreview = { accountId: string; contentToken: string; expiresAt: number }

/** Short-lived review tickets belong to one account and can be consumed only once. */
export class ImportPreviews {
  private pending = new Map<string, PendingPreview>()
  private now: () => number
  private limit: number

  constructor(now = Date.now, limit = 1000) {
    this.now = now
    this.limit = limit
  }

  /** Reserve bounded review state without evicting another administrator's valid ticket. */
  issue(accountId: string, contentToken: string): string {
    for (const [token, preview] of this.pending) {
      if (preview.expiresAt <= this.now()) {
        this.pending.delete(token)
      }
    }
    if (this.pending.size >= this.limit) {
      throw new ApplicationError('Too many pending import previews. Please retry shortly.', 429)
    }
    const token = randomBytes(32).toString('base64url')
    this.pending.set(token, { accountId, contentToken, expiresAt: this.now() + 600_000 })
    return token
  }

  /** @throws {ApplicationError} For expired, foreign-account or already consumed tickets. */
  consume(accountId: string, token: string): string {
    const preview = this.pending.get(token)
    if (!preview || preview.accountId !== accountId || preview.expiresAt <= this.now()) {
      throw new ApplicationError(
        'This import preview expired or belongs to another workspace. Preview again.',
        409,
      )
    }
    this.pending.delete(token)
    return preview.contentToken
  }
}
