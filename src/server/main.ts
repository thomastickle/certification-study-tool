import { createServer } from 'node:http'
import { mkdirSync, chmodSync, existsSync, statSync, createReadStream } from 'node:fs'
import { resolve, dirname, extname, sep } from 'node:path'
import { QuizService } from './quizzes/quiz-service.ts'
import { apiController } from './http-controller.ts'
import { LibraryRepository } from './questions/library-repository.ts'
import { OwnerAuthentication } from './auth/owner-authentication.ts'

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
  ownerSubject: process.env.STUDY_OWNER_SUBJECT ?? '',
  accountsPath,
}
const authentication = new OwnerAuthentication(authenticationOptions)
mkdirSync(dirname(databasePath), { recursive: true, mode: 0o700 })
const repository = new LibraryRepository(databasePath)
chmodSync(databasePath, 0o600)
const api = apiController(repository, origin)
const quizzes = new QuizService(repository)
quizzes.expireDue()
const expiryTimer = setInterval(() => {
  try {
    quizzes.expireDue()
  } catch {
    console.error('Could not score an expired quiz; it will be retried.')
  }
}, 1000)
expiryTimer.unref()
const production = process.env.NODE_ENV === 'production'
let webHandler: (
  request: import('node:http').IncomingMessage,
  response: import('node:http').ServerResponse,
) => void
const server = createServer((request, response) => {
  void handleRequest(request, response)
})

/** Admit the configured owner before forwarding requests to the unchanged study API. */
async function handleRequest(
  request: import('node:http').IncomingMessage,
  response: import('node:http').ServerResponse,
) {
  const handled = await authentication.handle(request, response)
  if (handled) {
    return
  }
  if (request.url?.startsWith('/api/')) {
    void api(request, response)
    return
  }
  webHandler(request, response)
}

let closeWeb = async () => {}

if (!production) {
  const { createServer: createViteServer } = await import('vite')
  const vite = await createViteServer({
    server: { middlewareMode: true, hmr: { server } },
    appType: 'spa',
  })
  webHandler = (request, response) => vite.middlewares(request, response)
  closeWeb = () => vite.close()
} else {
  const root = resolve('dist')
  if (!existsSync(resolve(root, 'index.html')))
    throw new Error('Run npm run build before starting production mode.')
  webHandler = (request, response) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405)
      response.end()
      return
    }
    try {
      const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname)
      let file = resolve(root, '.' + pathname)
      if (!file.startsWith(root + sep) && file !== root) throw new Error()
      if (file === root) file = resolve(root, 'index.html')
      if (!existsSync(file) && !extname(file)) file = resolve(root, 'index.html')
      if (!statSync(file).isFile()) throw new Error()
      const types: Record<string, string> = {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.svg': 'image/svg+xml',
        '.ico': 'image/x-icon',
      }
      response.writeHead(200, {
        'Content-Type': types[extname(file)] ?? 'application/octet-stream',
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-cache',
      })
      if (request.method === 'HEAD') response.end()
      else createReadStream(file).pipe(response)
    } catch {
      response.writeHead(404)
      response.end('Not found.')
    }
  }
}
server.listen(port, host, () => console.log(`Certification Study Tool: ${origin.origin}`))

async function shutdown() {
  clearInterval(expiryTimer)
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
