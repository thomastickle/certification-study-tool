import type { Identity } from './account-repository.ts'
import * as oidc from 'openid-client'

export type LoginTransaction = { state: string; verifier: string; nonce: string }

export type OidcSettings = { issuer: string; clientId: string; clientSecret?: string; origin: URL }

/** Validate local protocol settings without discovery, network access, or database allocation.
 * @throws {Error} For unsafe transports, non-origin callback bases, or an empty client identifier.
 */
export function validateOidcSettings(settings: OidcSettings): void {
  requireSafeTransport(new URL(settings.issuer))
  requireSafeTransport(settings.origin)
  if (settings.origin.pathname !== '/' || settings.origin.search || settings.origin.hash) {
    throw new Error('STUDY_ORIGIN must be an origin without a path, query, or fragment.')
  }
  if (!settings.clientId.trim()) {
    throw new Error('An OIDC client ID is required.')
  }
}

/** Keep protocol details behind the standard OIDC client boundary. */
export class OidcLogin {
  private settings: OidcSettings
  private configuration?: Promise<oidc.Configuration>

  constructor(settings: OidcSettings) {
    validateOidcSettings(settings)
    this.settings = settings
  }

  /** Generate fresh browser-bound values for every authorization request. */
  async begin(): Promise<{ url: URL; transaction: LoginTransaction }> {
    const config = await this.config()
    const transaction = {
      state: oidc.randomState(),
      verifier: oidc.randomPKCECodeVerifier(),
      nonce: oidc.randomNonce(),
    }
    const codeChallenge = await oidc.calculatePKCECodeChallenge(transaction.verifier)
    const parameters = {
      redirect_uri: new URL('/auth/callback', this.settings.origin).href,
      response_type: 'code',
      scope: 'openid profile',
      state: transaction.state,
      nonce: transaction.nonce,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    }
    const url = oidc.buildAuthorizationUrl(config, parameters)
    requireSafeTransport(url)
    return { url, transaction }
  }

  /** @throws When the standard client rejects the callback, grant, or ID token. */
  async complete(url: URL, transaction: LoginTransaction): Promise<Identity> {
    const config = await this.config()
    const checks = {
      pkceCodeVerifier: transaction.verifier,
      expectedState: transaction.state,
      expectedNonce: transaction.nonce,
      idTokenExpected: true,
    }
    const tokens = await oidc.authorizationCodeGrant(config, url, checks)
    const claims = tokens.claims()!
    const roles = claims.study_roles
    const hasRoleList = Array.isArray(roles) && roles.every((role) => typeof role === 'string')
    const admin = hasRoleList && roles.includes('admin')
    return {
      issuer: claims.iss,
      subject: claims.sub,
      name: typeof claims.name === 'string' ? claims.name : claims.sub,
      role: admin ? 'admin' : 'student',
    }
  }

  /** End the provider session as well as the application's own session when supported. */
  async logoutUrl(): Promise<URL | undefined> {
    const config = await this.config()
    if (!config.serverMetadata().end_session_endpoint) {
      return undefined
    }
    const parameters = {
      client_id: this.settings.clientId,
      post_logout_redirect_uri: this.settings.origin.origin + '/',
    }
    const url = oidc.buildEndSessionUrl(config, parameters)
    requireSafeTransport(url)
    return url
  }

  private async config(): Promise<oidc.Configuration> {
    this.configuration ??= this.discover()
    try {
      return await this.configuration
    } catch (error) {
      this.configuration = undefined
      throw error
    }
  }

  private async discover(): Promise<oidc.Configuration> {
    const { clientId, clientSecret } = this.settings
    const issuer = new URL(this.settings.issuer)
    const execute = [oidc.enableNonRepudiationChecks]
    if (issuer.protocol === 'http:') {
      execute.unshift(oidc.allowInsecureRequests)
    }
    const options: oidc.DiscoveryRequestOptions = {
      timeout: 10,
      execute,
      [oidc.customFetch]: fetchWithSafeTransport,
    }
    return oidc.discovery(issuer, clientId, clientSecret, undefined, options)
  }
}

/** Validate every provider request and normalize byte bodies for Node's native fetch. */
const fetchWithSafeTransport: oidc.CustomFetch = (input, init) => {
  requireSafeTransport(new URL(String(input)))
  const body = init.body
  if (body instanceof Uint8Array) {
    const byteBody = new Blob([new Uint8Array(body)])
    return fetch(input, { ...init, body: byteBody })
  }
  return fetch(input, { ...init, body })
}

/** Development HTTP is limited to loopback; credentials always require TLS elsewhere. */
export function requireSafeTransport(url: URL): void {
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
  const hasCredentials = Boolean(url.username || url.password)
  const allowsHttp = url.protocol === 'http:' && loopback
  const hasSafeProtocol = url.protocol === 'https:' || allowsHttp
  if (hasCredentials || !hasSafeProtocol) {
    throw new Error('OIDC and application URLs require HTTPS except on loopback addresses.')
  }
}
