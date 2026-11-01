import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { writePrivate } from './network-files.ts'
import { networkOrigin } from './network-profile.ts'
import type { NetworkProfile } from './network-profile.ts'

/**
 * Add exact HTTPS callbacks to the existing client without changing users, roles or existing callbacks.
 * @throws {Error} For rejected administrator credentials or an ambiguous/missing study client.
 */
export async function configureKeycloak(
  profile: NetworkProfile,
  environment: Record<string, string>,
  directory: string,
): Promise<void> {
  const base = `http://127.0.0.1:${profile.keycloakPort}`
  if (!environment.KC_BOOTSTRAP_ADMIN_PASSWORD) {
    throw new Error(
      'The existing local Keycloak administrator credential is required for initial setup.',
    )
  }
  const tokenResponse = await fetch(`${base}/realms/master/protocol/openid-connect/token`, {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
    body: new URLSearchParams({
      grant_type: 'password',
      client_id: 'admin-cli',
      username: environment.KC_BOOTSTRAP_ADMIN_USERNAME ?? 'local-admin',
      password: environment.KC_BOOTSTRAP_ADMIN_PASSWORD,
    }),
  })
  if (!tokenResponse.ok) {
    throw new Error(
      `Keycloak administrator login failed (${tokenResponse.status}). No client settings were changed.`,
    )
  }
  const token = (await tokenResponse.json()) as { access_token: string }
  const headers = { Authorization: `Bearer ${token.access_token}` }
  const clientsResponse = await fetch(`${base}/admin/realms/study/clients?clientId=study-tool`, {
    headers,
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
  })
  if (!clientsResponse.ok) {
    throw new Error(`Cannot inspect the existing study client (${clientsResponse.status}).`)
  }
  const clients = (await clientsResponse.json()) as {
    id: string
    redirectUris?: string[]
    webOrigins?: string[]
    attributes?: Record<string, string>
  }[]
  if (clients.length !== 1 || !clients[0]?.id) {
    throw new Error('Exactly one existing study-tool client is required.')
  }
  const client = clients[0]
  const backup = join(directory, 'keycloak-client-before.json')
  if (!existsSync(backup)) {
    writePrivate(backup, JSON.stringify(client, null, 2))
  }
  const origin = networkOrigin(profile)
  const attributes = { ...client.attributes }
  const logout = attributes['post.logout.redirect.uris']?.split('##') ?? []
  attributes['post.logout.redirect.uris'] = [...new Set([...logout, `${origin}/`])]
    .filter(Boolean)
    .join('##')
  const update = {
    redirectUris: [...new Set([...(client.redirectUris ?? []), `${origin}/auth/callback`])],
    webOrigins: [...new Set([...(client.webOrigins ?? []), origin])],
    attributes,
  }
  const updateResponse = await fetch(
    `${base}/admin/realms/study/clients/${encodeURIComponent(client.id)}`,
    {
      method: 'PUT',
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(update),
    },
  )
  if (!updateResponse.ok) {
    throw new Error(`Cannot register the exact HTTPS callback (${updateResponse.status}).`)
  }
}
