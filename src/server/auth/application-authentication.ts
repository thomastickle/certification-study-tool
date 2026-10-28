import type { IncomingMessage, ServerResponse } from 'node:http'
import { chmodSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomBytes } from 'node:crypto'
import type { OidcSettings } from './oidc-login.ts'
import { OidcLogin } from './oidc-login.ts'
import type { LoginTransaction } from './oidc-login.ts'
import { AccountRepository } from './account-repository.ts'
import { admitRequest } from '../http/admit-request.ts'
import { ApplicationError } from '../http/errors.ts'
import type { RequestUrl } from '../http/request-url.ts'
import type { SessionUser } from '../../shared/auth-contracts.ts'

export type AuthenticationOptions = OidcSettings & {
  accountsPath: string
  now?: () => number
}

/** Establish verified identities and bind each admitted request to its own account and session role. */
export class ApplicationAuthentication {
  private accounts: AccountRepository
  private login: OidcLogin
  private options: AuthenticationOptions
  private now: () => number
  private pending = new Map<string, { transaction: LoginTransaction; expiresAt: number }>()
  private startingLogins = 0
  private sessionName: string
  private loginName: string

  constructor(options: AuthenticationOptions) {
    this.login = new OidcLogin(options)
    this.options = options
    this.now = options.now ?? Date.now
    mkdirSync(dirname(options.accountsPath), { recursive: true, mode: 0o700 })
    const accounts = new AccountRepository(options.accountsPath)
    try {
      chmodSync(options.accountsPath, 0o600)
      this.accounts = accounts
    } catch (error) {
      accounts.close()
      throw error
    }
    const secure = options.origin.protocol === 'https:'
    this.sessionName = secure ? '__Host-study_session' : 'study_session'
    this.loginName = secure ? '__Secure-study_login' : 'study_login'
  }

  /** Map an operator-selected legacy owner without issuing a login or granting any role. */
  legacyOwnerId(subject: string): string {
    if (!subject.trim()) {
      throw new Error('STUDY_LEGACY_OWNER_SUBJECT must identify the previous study owner.')
    }
    const issuer = this.options.issuer
    const existing = this.accounts.findIdentity(issuer, subject)
    return existing?.id ?? this.accounts.identify({ issuer, subject, name: subject }).id
  }

  /** Permit provider return documents while retaining origin checks on auth and study operations. */
  admit(request: IncomingMessage): RequestUrl {
    return admitRequest(request, this.options.origin)
  }

  /** Resolve only the durable, issuer-verified session; headers never select an account. */
  session(request: IncomingMessage): SessionUser | undefined {
    const token = cookie(request, this.sessionName)
    return token ? this.accounts.session(token, this.now(), this.options.issuer) : undefined
  }

  /** Enforce the browser's workspace binding after identity verification.
   * @throws {ApplicationError} For missing sessions or a stale workspace binding.
   */
  requireWorkspace(request: IncomingMessage, user: SessionUser | undefined): SessionUser {
    if (!user) {
      throw new ApplicationError('Sign in to access study data.', 401)
    }
    if (request.headers['x-study-account'] !== user.id) {
      throw new WorkspaceChangedError()
    }
    return user
  }

  /** Supersede the browser's old attempt and reserve capacity across asynchronous provider work. */
  async startLogin(request: IncomingMessage, response: ServerResponse): Promise<void> {
    for (const [key, value] of this.pending) {
      if (value.expiresAt <= this.now()) {
        this.pending.delete(key)
      }
    }
    const previous = cookie(request, this.loginName)
    if (previous) {
      this.pending.delete(previous)
    }
    const pendingCount = this.pending.size + this.startingLogins
    if (pendingCount >= 1000) {
      throw new ApplicationError('Too many pending logins. Please retry shortly.', 429)
    }
    let started: Awaited<ReturnType<OidcLogin['begin']>>
    this.startingLogins++
    try {
      started = await this.login.begin()
    } catch {
      throw new ApplicationError('The sign-in provider is unavailable. Please retry.', 503)
    } finally {
      this.startingLogins--
    }
    const key = randomBytes(32).toString('base64url')
    this.pending.set(key, { transaction: started.transaction, expiresAt: this.now() + 600_000 })
    response.setHeader('Set-Cookie', this.makeLoginCookies(key, 600))
    redirect(response, started.url.href)
    return
  }

  /** Consume the pending attempt once, verify the issuer response, then establish a local session. */
  async completeLogin(
    request: IncomingMessage,
    response: ServerResponse,
    url: RequestUrl,
  ): Promise<void> {
    const key = cookie(request, this.loginName)
    const pending = key ? this.pending.get(key) : undefined
    if (key) {
      this.pending.delete(key)
    }
    response.setHeader('Set-Cookie', this.makeLoginCookies('', 0))
    if (!pending || pending.expiresAt <= this.now()) {
      throw new ApplicationError(
        'This sign-in request expired or belongs to another browser. Start sign-in again.',
        400,
      )
    }
    let identity
    try {
      identity = await this.login.complete(
        new URL(url.pathname + url.search, this.options.origin),
        pending.transaction,
      )
    } catch {
      throw new ApplicationError('Sign-in could not be verified. Start sign-in again.', 400)
    }
    const sameIssuer = identity.issuer === this.options.issuer
    if (!sameIssuer) {
      const previous = cookie(request, this.sessionName)
      if (previous) {
        this.accounts.revokeSession(previous)
      }
      response.setHeader('Set-Cookie', [
        ...this.makeLoginCookies('', 0),
        this.makeCookie(this.sessionName, '', 0, '/'),
      ])
      throw new ApplicationError(
        'This account does not belong to the configured sign-in provider.',
        403,
      )
    }
    const account = this.accounts.identify(identity)
    const previous = cookie(request, this.sessionName)
    if (previous) {
      this.accounts.revokeSession(previous)
    }
    const token = randomBytes(32).toString('base64url')
    const now = this.now()
    this.accounts.pruneExpiredSessions(now)
    this.accounts.saveSession(token, account.id, now + 8 * 60 * 60_000, identity.role ?? 'student')
    response.setHeader('Set-Cookie', [
      ...this.makeLoginCookies('', 0),
      this.makeCookie(this.sessionName, token, 8 * 60 * 60, '/'),
    ])
    redirect(response, '/')
    return
  }

  /** Revoke local access before attempting provider logout, including during provider outages. */
  async logout(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const token = cookie(request, this.sessionName)
    if (token) {
      this.accounts.revokeSession(token)
    }
    response.setHeader('Set-Cookie', this.makeCookie(this.sessionName, '', 0, '/'))
    let destination = '/'
    try {
      const providerLogout = await this.login.logoutUrl()
      destination = providerLogout?.href ?? '/'
    } catch {
      // Provider outages must not prevent invalidating the local session.
    }
    redirect(response, destination, 303)
    return
  }

  /** Share the login cookie across auth routes and remove the former callback-only cookie. */
  private makeLoginCookies(value: string, seconds: number): string[] {
    return [
      this.makeCookie(this.loginName, value, seconds, '/auth'),
      this.makeCookie(this.loginName, '', 0, '/auth/callback'),
    ]
  }

  private makeCookie(name: string, value: string, seconds: number, path: string): string {
    const secure = this.options.origin.protocol === 'https:' ? '; Secure' : ''
    return `${name}=${value}; Path=${path}; HttpOnly; SameSite=Lax; Max-Age=${seconds}${secure}`
  }

  close(): void {
    this.pending.clear()
    this.accounts.close()
  }
}

/** Preserve the distinct workspace rejection schema at both transitional and Nest boundaries. */
export class WorkspaceChangedError extends ApplicationError {
  constructor() {
    super('Your sign-in changed. Reopen the workspace before continuing.', 409)
  }
}

/** Ambiguous duplicate cookie names are rejected rather than trusting their order. */
function cookie(request: IncomingMessage, name: string): string | undefined {
  const values = (request.headers.cookie ?? '')
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.startsWith(name + '='))
  return values.length === 1 ? values[0]!.slice(name.length + 1) : undefined
}

function redirect(response: ServerResponse, location: string, status = 302): void {
  response.writeHead(status, { Location: location, 'Cache-Control': 'no-store' })
  response.end()
}
