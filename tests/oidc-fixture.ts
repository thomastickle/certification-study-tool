import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'

type AuthorizationCode = { challenge: string; nonce: string; subject: string }

/** A synthetic issuer exercises the real OIDC client, including its signature validation. */
export async function oidcFixture() {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const otherKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey
  const codes = new Map<string, AuthorizationCode>()
  let tokenError: 'signature' | 'issuer' | 'audience' | 'nonce' | 'expired' | undefined

  /** Publish the endpoints and capabilities consumed by standard OIDC discovery. */
  function respondToDiscovery(response: ServerResponse): void {
    const metadata = {
      issuer,
      authorization_endpoint: issuer + '/authorize',
      token_endpoint: issuer + '/token',
      jwks_uri: issuer + '/jwks',
      end_session_endpoint: issuer + '/logout',
      response_types_supported: ['code'],
      subject_types_supported: ['public'],
      id_token_signing_alg_values_supported: ['RS256'],
      token_endpoint_auth_methods_supported: ['none'],
      code_challenge_methods_supported: ['S256'],
    }
    response.end(JSON.stringify(metadata))
  }

  /** Expose only the public key used to validate the synthetic issuer's signatures. */
  function respondToSigningKeys(response: ServerResponse): void {
    const signingKey = {
      ...publicKey.export({ format: 'jwk' }),
      kid: 'test',
      alg: 'RS256',
      use: 'sig',
    }
    response.end(JSON.stringify({ keys: [signingKey] }))
  }

  /** Bind a single-use authorization code to the browser's PKCE challenge and nonce. */
  function authorizeCode(url: URL, response: ServerResponse): void {
    const callback = new URL(url.searchParams.get('redirect_uri')!)
    const code = String(codes.size) + '-' + url.searchParams.get('state')
    codes.set(code, {
      challenge: url.searchParams.get('code_challenge')!,
      nonce: url.searchParams.get('nonce')!,
      subject: url.searchParams.get('user') ?? 'alice',
    })
    callback.searchParams.set('code', code)
    callback.searchParams.set('state', url.searchParams.get('state')!)
    callback.searchParams.set('iss', issuer)
    response.writeHead(302, { Location: callback.href })
    response.end()
  }

  /** Sign valid claims or inject the one protocol fault selected by the test. */
  function createIdToken(grant: AuthorizationCode): string {
    const now = Math.floor(Date.now() / 1000)
    const claims = {
      iss: tokenError === 'issuer' ? 'https://wrong.example' : issuer,
      aud: tokenError === 'audience' ? 'wrong' : 'study-tool',
      sub: grant.subject,
      name: grant.subject,
      nonce: tokenError === 'nonce' ? 'wrong' : grant.nonce,
      iat: now,
      exp: tokenError === 'expired' ? now - 600 : now + 300,
    }
    const payload = [{ alg: 'RS256', kid: 'test' }, claims]
      .map((part) => Buffer.from(JSON.stringify(part)).toString('base64url'))
      .join('.')
    const signingKey = tokenError === 'signature' ? otherKey : privateKey
    const signature = sign('RSA-SHA256', Buffer.from(payload), signingKey).toString('base64url')
    return payload + '.' + signature
  }

  /** Consume a code before validating PKCE, including when the exchange is rejected. */
  async function exchangeCodeForToken(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const chunks: Buffer[] = []
    for await (const chunk of request) {
      chunks.push(Buffer.from(chunk))
    }
    const params = new URLSearchParams(Buffer.concat(chunks).toString())
    const code = params.get('code')!
    const grant = codes.get(code)
    codes.delete(code)
    const verifier = params.get('code_verifier') ?? ''
    const challenge = createHash('sha256').update(verifier).digest('base64url')
    if (!grant || challenge !== grant.challenge) {
      response.writeHead(400)
      response.end(JSON.stringify({ error: 'invalid_grant' }))
      return
    }
    const tokens = {
      token_type: 'Bearer',
      access_token: 'synthetic-token',
      expires_in: 300,
      id_token: createIdToken(grant),
    }
    response.end(JSON.stringify(tokens))
  }

  /** Route each protocol phase while keeping keys, codes, and fault selection in the fixture. */
  async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url!, issuer)
    response.setHeader('Content-Type', 'application/json')
    if (url.pathname.endsWith('/.well-known/openid-configuration')) {
      respondToDiscovery(response)
    } else if (url.pathname.endsWith('/jwks')) {
      respondToSigningKeys(response)
    } else if (url.pathname.endsWith('/authorize')) {
      authorizeCode(url, response)
    } else if (url.pathname.endsWith('/token')) {
      await exchangeCodeForToken(request, response)
    } else {
      response.writeHead(404)
      response.end('{}')
    }
  }

  const server = createServer(handleRequest)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Missing fixture port')
  }
  const issuer = `http://127.0.0.1:${address.port}/realms/test`
  return {
    issuer: new URL(issuer),
    server,
    invalidate: (error: typeof tokenError) => {
      tokenError = error
    },
  }
}

export async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  )
}
