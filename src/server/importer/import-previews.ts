import { randomBytes } from 'node:crypto'
import { ApplicationError } from '../errors.ts'

type PendingPreview = {
  accountId: string
  library: 'shared' | 'private'
  contentToken: string
  expiresAt: number
}

/** Short-lived review tickets belong to one account and can be consumed only once. */
export class ImportPreviews {
  private pending = new Map<string, PendingPreview>()
  private now: () => number
  private limit: number
  private perAccountLimit: number

  constructor(now = Date.now, limit = 1000, perAccountLimit = 20) {
    this.now = now
    this.limit = limit
    this.perAccountLimit = perAccountLimit
  }

  /** Reserve bounded review state without evicting another administrator's valid ticket. */
  issue(accountId: string, contentToken: string, library: 'shared' | 'private' = 'shared'): string {
    for (const [token, preview] of this.pending) {
      if (preview.expiresAt <= this.now()) {
        this.pending.delete(token)
      }
    }
    const ownPending = [...this.pending.values()].filter(
      (preview) => preview.accountId === accountId,
    ).length
    if (this.pending.size >= this.limit || ownPending >= this.perAccountLimit) {
      throw new ApplicationError('Too many pending import previews. Please retry shortly.', 429)
    }
    const token = randomBytes(32).toString('base64url')
    this.pending.set(token, { accountId, library, contentToken, expiresAt: this.now() + 600_000 })
    return token
  }

  /** @throws {ApplicationError} For expired, foreign-account or already consumed tickets. */
  consume(accountId: string, token: string, library: 'shared' | 'private' = 'shared'): string {
    const preview = this.pending.get(token)
    if (
      !preview ||
      preview.accountId !== accountId ||
      preview.library !== library ||
      preview.expiresAt <= this.now()
    ) {
      throw new ApplicationError(
        'This import preview expired or belongs to another workspace. Preview again.',
        409,
      )
    }
    this.pending.delete(token)
    return preview.contentToken
  }
}
