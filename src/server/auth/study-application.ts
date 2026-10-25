import type { IncomingMessage, ServerResponse } from 'node:http'
import { chmodSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { randomBytes } from 'node:crypto'
import type { OidcSettings } from './oidc-login.ts'
import { OidcLogin } from './oidc-login.ts'
import type { LoginTransaction } from './oidc-login.ts'
import { AccountRepository } from './account-repository.ts'
import { apiController, checkLocalRequest } from '../http-controller.ts'
import { LibraryRepository } from '../questions/library-repository.ts'
import { QuizService } from '../quizzes/quiz-service.ts'
import { ApplicationError } from '../errors.ts'
import { lockDataDirectory } from './data-lock.ts'
import { sendJson } from '../http-messages.ts'

export type StudyApplicationOptions = OidcSettings & { dataDirectory: string; now?: () => number }

/** Resolve authenticated requests to the account's private application services. */
export class StudyApplication {
  private accounts: AccountRepository
  private login: OidcLogin
  private options: StudyApplicationOptions
  private now: () => number
  private pending = new Map<string, { transaction: LoginTransaction; expiresAt: number }>()
  private startingLogins = 0
  private sessionName: string
  private loginName: string
  private releaseData: () => void

  constructor(options: StudyApplicationOptions) {
    this.login = new OidcLogin(options)
    this.options = { ...options, dataDirectory: resolve(options.dataDirectory) }
    this.now = options.now ?? Date.now
    const directory = this.options.dataDirectory
    this.releaseData = lockDataDirectory(directory)
    let accounts: AccountRepository | undefined
    try {
      mkdirSync(join(directory, 'users'), { recursive: true, mode: 0o700 })
      const path = join(directory, 'accounts.sqlite3')
      accounts = new AccountRepository(path)
      chmodSync(path, 0o600)
      this.accounts = accounts
    } catch (error) {
      accounts?.close()
      this.releaseData()
      throw error
    }
    const secure = options.origin.protocol === 'https:'
    this.sessionName = secure ? '__Host-study_session' : 'study_session'
    this.loginName = secure ? '__Secure-study_login' : 'study_login'
  }

  /** Validate the request before routing authentication, public assets, or private study APIs. */
  async handle(request: IncomingMessage, response: ServerResponse): Promise<boolean> {
    try {
      const url = this.validateRequest(request)
      response.setHeader('Referrer-Policy', 'same-origin')
      if (url.pathname.startsWith('/auth/')) {
        response.setHeader('Referrer-Policy', 'no-referrer')
        await this.authRoute(request, response, url)
        return true
      }
      if (!url.pathname.startsWith('/api/')) {
        return false
      }
      await this.handleStudyApi(request, response, url)
      return true
    } catch (error) {
      const expected = error instanceof ApplicationError
      const status = expected ? error.status : 500
      const message = expected ? error.message : 'The request could not be completed. Please retry.'
      sendJson(response, status, { error: message })
      return true
    }
  }

  /** Permit provider return documents while retaining origin checks on auth and study operations. */
  private validateRequest(request: IncomingMessage): URL {
    const url = new URL(request.url ?? '/', this.options.origin)
    // Cross-site redirects from an issuer must reach both the callback and the public shell.
    const callback = url.pathname === '/auth/callback'
    const publicPage = !url.pathname.startsWith('/api/') && !url.pathname.startsWith('/auth/')
    const publicNavigation = request.method === 'GET' && (callback || publicPage)
    checkLocalRequest(request, this.options.origin, publicNavigation)
    if (url.origin !== this.options.origin.origin) {
      throw new ApplicationError('Invalid request URL.', 403)
    }
    return url
  }

  /** Authorize the account binding before opening and owning its private database lifetime. */
  private async handleStudyApi(
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
  ): Promise<void> {
    if (url.pathname === '/api/health' && request.method === 'GET') {
      sendJson(response, 200, { status: 'ok' })
      return
    }
    const token = cookie(request, this.sessionName)
    const user = token ? this.accounts.session(token, this.now()) : undefined
    if (url.pathname === '/api/session' && request.method === 'GET') {
      sendJson(response, 200, { user: user ?? null })
      return
    }
    if (!user) {
      throw new ApplicationError('Sign in to access your private workspace.', 401)
    }
    if (request.headers['x-study-account'] !== user.id) {
      sendJson(response, 409, {
        code: 'workspace_changed',
        error: 'Your signed-in account changed. Sign in again to reopen the workspace.',
      })
      return
    }
    const path = join(this.options.dataDirectory, 'users', user.id + '.sqlite3')
    const repository = new LibraryRepository(path)
    try {
      chmodSync(path, 0o600)
      new QuizService(repository).expireDue()
      const api = apiController(repository, { origin: this.options.origin, workspaceId: user.id })
      await api(request, response)
    } finally {
      repository.close()
    }
  }

  /** Map each authentication route to its workflow; each flow owns its cookies and failure rules. */
  private async authRoute(
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
  ): Promise<void> {
    response.setHeader('Cache-Control', 'no-store')
    if (url.pathname === '/auth/login' && request.method === 'GET') {
      return this.startLogin(request, response)
    }
    if (url.pathname === '/auth/callback' && request.method === 'GET') {
      return this.completeLogin(request, response, url)
    }
    if (url.pathname === '/auth/logout' && request.method === 'POST') {
      return this.logout(request, response)
    }
    throw new ApplicationError('Not found.', 404)
  }

  /** Supersede the browser's old attempt and reserve capacity across asynchronous provider work. */
  private async startLogin(request: IncomingMessage, response: ServerResponse): Promise<void> {
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
  private async completeLogin(
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
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
      identity = await this.login.complete(url, pending.transaction)
    } catch {
      throw new ApplicationError('Sign-in could not be verified. Start sign-in again.', 400)
    }
    const account = this.accounts.identify(identity)
    const previous = cookie(request, this.sessionName)
    if (previous) {
      this.accounts.revokeSession(previous)
    }
    const token = randomBytes(32).toString('base64url')
    const now = this.now()
    this.accounts.pruneExpiredSessions(now)
    this.accounts.saveSession(token, account.id, now + 8 * 60 * 60_000)
    response.setHeader('Set-Cookie', [
      ...this.makeLoginCookies('', 0),
      this.makeCookie(this.sessionName, token, 8 * 60 * 60, '/'),
    ])
    redirect(response, '/')
    return
  }

  /** Revoke local access before attempting provider logout, including during provider outages. */
  private async logout(request: IncomingMessage, response: ServerResponse): Promise<void> {
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
    try {
      this.accounts.close()
    } finally {
      this.releaseData()
    }
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
