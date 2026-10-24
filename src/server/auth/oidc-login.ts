import type { Identity } from './account-repository.ts'
import * as oidc from 'openid-client'

export type LoginTransaction = { state: string; verifier: string; nonce: string }

export type OidcSettings = { issuer: URL; clientId: string; clientSecret?: string; origin: URL }

/** Keep protocol details behind the standard OIDC client boundary. */
export class OidcLogin {
  private settings: OidcSettings
  private configuration?: Promise<oidc.Configuration>

  constructor(settings: OidcSettings) {
    requireSafeTransport(settings.issuer)
    requireSafeTransport(settings.origin)
    if (settings.origin.pathname !== '/' || settings.origin.search || settings.origin.hash) {
      throw new Error('STUDY_ORIGIN must be an origin without a path, query, or fragment.')
    }
    if (!settings.clientId.trim()) throw new Error('An OIDC client ID is required.')
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
    const url = oidc.buildAuthorizationUrl(config, {
      redirect_uri: new URL('/auth/callback', this.settings.origin).href,
      response_type: 'code',
      scope: 'openid profile',
      state: transaction.state,
      nonce: transaction.nonce,
      code_challenge: await oidc.calculatePKCECodeChallenge(transaction.verifier),
      code_challenge_method: 'S256',
    })
    requireSafeTransport(url)
    return { url, transaction }
  }

  /** @throws When the standard client rejects the callback, grant, or ID token. */
  async complete(url: URL, transaction: LoginTransaction): Promise<Identity> {
    const tokens = await oidc.authorizationCodeGrant(await this.config(), url, {
      pkceCodeVerifier: transaction.verifier,
      expectedState: transaction.state,
      expectedNonce: transaction.nonce,
      idTokenExpected: true,
    })
    const claims = tokens.claims()!
    return {
      issuer: claims.iss,
      subject: claims.sub,
      name: typeof claims.name === 'string' ? claims.name : claims.sub,
    }
  }

  /** End the provider session as well as the application's own session when supported. */
  async logoutUrl(): Promise<URL | undefined> {
    const config = await this.config()
    if (!config.serverMetadata().end_session_endpoint) return undefined
    const url = oidc.buildEndSessionUrl(config, {
      client_id: this.settings.clientId,
      post_logout_redirect_uri: this.settings.origin.origin + '/',
    })
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
    const { issuer, clientId, clientSecret } = this.settings
    return oidc.discovery(issuer, clientId, clientSecret, undefined, {
      timeout: 10,
      execute:
        issuer.protocol === 'http:'
          ? [oidc.allowInsecureRequests, oidc.enableNonRepudiationChecks]
          : [oidc.enableNonRepudiationChecks],
      [oidc.customFetch]: (input, init) => {
        requireSafeTransport(new URL(String(input)))
        const body =
          init.body instanceof Uint8Array ? new Blob([new Uint8Array(init.body)]) : init.body
        return fetch(input, { ...init, body })
      },
    })
  }
}

/** Development HTTP is limited to loopback; credentials always require TLS elsewhere. */
export function requireSafeTransport(url: URL): void {
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
  if (
    url.username ||
    url.password ||
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))
  ) {
    throw new Error('OIDC and application URLs require HTTPS except on loopback addresses.')
  }
}
