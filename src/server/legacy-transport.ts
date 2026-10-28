import type { SessionUser } from '../shared/auth-contracts.ts'
import { existsSync } from 'node:fs'
import { createServer } from 'node:http'
import { resolve } from 'node:path'
import { DevelopmentVite } from './development-vite.ts'
import { apiController } from './http-controller.ts'
import { applicationRequestHandler } from './request-handler.ts'
import type { RoutedHttpHandler } from './request-handler.ts'
import { developmentWebHandler, staticWebHandler } from './web-handler.ts'
import type { ApplicationRuntime } from './application-runtime.ts'
import type { RuntimeConfiguration } from './runtime-configuration.ts'

/** Retain the full existing routing during stage two; this transport does not own database roots.
 * @throws Rejects web initialization and listen failures; the caller must close its Nest context.
 */
export async function startLegacyTransport(
  runtime: ApplicationRuntime,
  configuration: RuntimeConfiguration,
) {
  let webHandler: RoutedHttpHandler

  let closeWeb = async () => {}

  const handlers = {
    authentication: runtime.authentication,
    study:
      (verifiedSessionUser: SessionUser): RoutedHttpHandler =>
      (request, response, url) =>
        runtime.studyLibraries.withLibrary(
          verifiedSessionUser,
          request.method,
          async (personal) => {
            const api = apiController(
              runtime.sharedLibrary,
              verifiedSessionUser,
              configuration.origin,
              runtime.previews,
              personal,
            )
            await api(request, response, url)
          },
        ),
    web: (request, response, url) => webHandler(request, response, url),
  } satisfies Parameters<typeof applicationRequestHandler>[0]
  const handle = applicationRequestHandler(handlers)
  const active = new Set<Promise<void>>()
  const server = createServer((request, response) => {
    const pending = Promise.resolve(handle(request, response))
    active.add(pending)
    void pending.finally(() => active.delete(pending))
  })
  let closing: Promise<void> | undefined

  /** Close HMR sockets first, then abort HTTP sockets and await handlers, including deferred bodies. */
  async function drain(): Promise<void> {
    try {
      await closeWeb()
    } finally {
      const closed = new Promise<void>((done, reject) => {
        server.close((error) => {
          if (error && (error as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING') {
            reject(error)
          } else {
            done()
          }
        })
      })
      server.closeAllConnections()
      try {
        await closed
      } finally {
        await Promise.allSettled([...active])
      }
    }
  }

  runtime.attachTransport(() => {
    closing ??= drain()
    return closing
  })
  if (configuration.production) {
    if (!existsSync(resolve(configuration.staticRoot, 'index.html'))) {
      throw new Error('Run npm run build before starting production mode.')
    }
    webHandler = staticWebHandler(configuration.staticRoot)
  } else {
    const development = new DevelopmentVite()
    closeWeb = () => development.close()
    const vite = await development.initialize(server)
    webHandler = developmentWebHandler((request, response) => vite.middlewares(request, response))
  }
  await new Promise<void>((done, reject) => {
    server.once('error', reject)
    server.listen(configuration.port, configuration.host, () => {
      server.off('error', reject)
      done()
    })
  })
  return server
}
