import { dirname, resolve } from 'node:path'
import { validateOidcSettings } from './auth/oidc-login.ts'
import type { AuthenticationOptions } from './auth/application-authentication.ts'

export const RUNTIME_CONFIGURATION = Symbol('RuntimeConfiguration')

export type RuntimeConfiguration = {
  /** Explicit app-local benchmark scheduling; omitted in production. */
  housekeepingSchedule?: { intervalMs: number; monotonicNow: () => number }
  host: string
  port: number
  origin: URL
  databasePath: string
  privateLibrariesDirectory: string
  authentication: AuthenticationOptions
  legacyOwnerSubject: string | undefined
  production: boolean
  staticRoot: string
}

/** Resolve settings without opening files, contacting OIDC, or capturing environment at import time.
 * @throws {Error} For invalid ports, origin URLs, or colliding shared/accounts paths.
 */
export function runtimeConfiguration(environment: NodeJS.ProcessEnv): RuntimeConfiguration {
  const host = environment.STUDY_HOST ?? '127.0.0.1'
  const port = Number(environment.STUDY_PORT ?? '3000')
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('STUDY_PORT must be a valid port.')
  }
  const databasePath = resolve(environment.STUDY_DB_PATH ?? 'private/app/library.sqlite3')
  const accountsPath = resolve(
    environment.STUDY_ACCOUNTS_PATH ?? resolve(dirname(databasePath), 'accounts.sqlite3'),
  )
  if (accountsPath === databasePath) {
    throw new Error('STUDY_ACCOUNTS_PATH must be separate from STUDY_DB_PATH.')
  }
  const origin = new URL(environment.STUDY_ORIGIN ?? `http://127.0.0.1:${port}`)
  const authentication = {
    origin,
    issuer: environment.STUDY_OIDC_ISSUER ?? 'http://127.0.0.1:8080/realms/study',
    clientId: environment.STUDY_OIDC_CLIENT_ID ?? 'study-tool',
    clientSecret: environment.STUDY_OIDC_CLIENT_SECRET || undefined,
    accountsPath,
  }
  validateOidcSettings(authentication)
  return {
    host,
    port,
    origin,
    databasePath,
    privateLibrariesDirectory: resolve(
      environment.STUDY_PRIVATE_LIBRARIES_DIR ?? resolve(dirname(databasePath), 'users'),
    ),
    authentication,
    legacyOwnerSubject: environment.STUDY_LEGACY_OWNER_SUBJECT || undefined,
    production: environment.NODE_ENV === 'production',
    staticRoot: resolve('dist'),
  }
}
