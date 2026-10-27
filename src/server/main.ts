import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { mkdirSync, chmodSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { apiController } from './http-controller.ts'
import { LibraryRepository } from './questions/library-repository.ts'
import { ApplicationAuthentication } from './auth/application-authentication.ts'
import { ImportPreviews } from './importer/import-previews.ts'
import { applicationRequestHandler } from './request-handler.ts'
import { staticWebHandler, developmentWebHandler } from './web-handler.ts'
import type { RequestUrl } from './request-url.ts'
import type { RoutedHttpHandler, ApplicationHandlers } from './request-handler.ts'
import type { SessionUser } from '../shared/auth-contracts.ts'
import { PrivateLibraries } from './questions/private-libraries.ts'
import { StudyHousekeeping } from './questions/study-housekeeping.ts'

const host = process.env.STUDY_HOST ?? '127.0.0.1'
const port = Number(process.env.STUDY_PORT ?? '3000')
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error('STUDY_PORT must be a valid port.')
const databasePath = resolve(process.env.STUDY_DB_PATH ?? 'private/app/library.sqlite3')
const accountsPath = resolve(
  process.env.STUDY_ACCOUNTS_PATH ?? resolve(dirname(databasePath), 'accounts.sqlite3'),
)
if (accountsPath === databasePath) {
  throw new Error('STUDY_ACCOUNTS_PATH must be separate from STUDY_DB_PATH.')
}
const origin = new URL(process.env.STUDY_ORIGIN ?? `http://127.0.0.1:${port}`)
const authenticationOptions = {
  origin,
  issuer: process.env.STUDY_OIDC_ISSUER ?? 'http://127.0.0.1:8080/realms/study',
  clientId: process.env.STUDY_OIDC_CLIENT_ID ?? 'study-tool',
  clientSecret: process.env.STUDY_OIDC_CLIENT_SECRET || undefined,
  accountsPath,
}
const authentication = new ApplicationAuthentication(authenticationOptions)
const previews = new ImportPreviews()
const privateLibraries = new PrivateLibraries(
  process.env.STUDY_PRIVATE_LIBRARIES_DIR ?? resolve(dirname(databasePath), 'users'),
)
mkdirSync(dirname(databasePath), { recursive: true, mode: 0o700 })
const legacySubject = process.env.STUDY_LEGACY_OWNER_SUBJECT
const legacyOwner = legacySubject ? authentication.legacyOwnerId(legacySubject) : undefined
let repository: LibraryRepository
try {
  repository = new LibraryRepository(databasePath, 'local', { legacyOwnerId: legacyOwner })
} catch (error) {
  authentication.close()
  throw error
}
chmodSync(databasePath, 0o600)
const housekeeping = new StudyHousekeeping(repository, privateLibraries)
try {
  privateLibraries.migrateFrom(repository)
  await housekeeping.tick()
} catch (error) {
  repository.close()
  authentication.close()
  throw error
}
const expiryTimer = setInterval(() => housekeeping.tick(), 1000)
expiryTimer.unref()
const production = process.env.NODE_ENV === 'production'
let webHandler: RoutedHttpHandler
const handlers: ApplicationHandlers = {
  authentication,
  study: (user) => (request, response, url) => serveStudy(user, request, response, url),
  web: (request, response, url) => webHandler(request, response, url),
}

const server = createServer(applicationRequestHandler(handlers))

/** Keep a private connection alive through its request, including body reads and failure cleanup. */
async function serveStudy(
  user: SessionUser,
  request: IncomingMessage,
  response: ServerResponse,
  url: RequestUrl,
) {
  const privateLibrary = privateLibraries.open(user.id)
  try {
    const api = apiController(repository, user, origin, previews, privateLibrary)
    await api(request, response, url)
  } finally {
    housekeeping.observeRequest(request.method, user.id, privateLibrary)
    privateLibrary.close()
  }
}

let closeWeb = async () => {}

if (!production) {
  const { createServer: createViteServer } = await import('vite')
  const vite = await createViteServer({
    server: { middlewareMode: true, hmr: { server } },
    appType: 'spa',
  })
  webHandler = developmentWebHandler((request, response) => vite.middlewares(request, response))
  closeWeb = () => vite.close()
} else {
  const root = resolve('dist')
  if (!existsSync(resolve(root, 'index.html')))
    throw new Error('Run npm run build before starting production mode.')
  webHandler = staticWebHandler(root)
}
server.listen(port, host, () => console.log(`Certification Study Tool: ${origin.origin}`))

async function shutdown() {
  clearInterval(expiryTimer)
  await housekeeping.stop()
  // Vite owns upgraded HMR sockets; close those before awaiting HTTP shutdown.
  await closeWeb()
  server.close(() => {
    repository.close()
    authentication.close()
    process.exit(0)
  })
  server.closeAllConnections()
}

process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)
