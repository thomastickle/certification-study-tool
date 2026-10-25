import type { IncomingMessage, ServerResponse } from 'node:http'
import { ConceptService } from './concepts/concept-service.ts'
import { conceptRoute } from './concepts/concept-routes.ts'
import { ReportService } from './reports/report-service.ts'
import { QuizService } from './quizzes/quiz-service.ts'
import { ApplicationError } from './errors.ts'
import { ImportService } from './importer/import-service.ts'
import { LibraryRepository } from './questions/library-repository.ts'
import { LibraryService } from './questions/library-service.ts'
import { HomeService } from './home/home-service.ts'
import { homeRoute } from './home/home-routes.ts'
import { reportRoute } from './reports/report-routes.ts'
import { quizRoute } from './quizzes/quiz-routes.ts'
import { importRoute } from './importer/import-routes.ts'
import { libraryRoute } from './questions/library-routes.ts'
import { readJsonBody, sendJson } from './http-messages.ts'

/** Prevent other websites from driving a local library through this server. */
export function checkLocalRequest(
  request: IncomingMessage,
  publicOrigin?: URL,
  allowCallback = false,
): void {
  const port = request.socket.localPort
  const hosts = publicOrigin ? [publicOrigin.host] : [`127.0.0.1:${port}`, `localhost:${port}`]
  const origins = publicOrigin ? [publicOrigin.origin] : hosts.map((host) => `http://${host}`)
  if (!hosts.includes(request.headers.host ?? ''))
    throw new ApplicationError('Local access only.', 403)
  const origin = request.headers.origin
  if (
    (origin && !origins.includes(origin)) ||
    (!allowCallback && request.headers['sec-fetch-site'] === 'cross-site') ||
    (publicOrigin &&
      !['GET', 'HEAD'].includes(request.method ?? '') &&
      origin !== publicOrigin.origin)
  ) {
    throw new ApplicationError('Cross-site requests are not allowed.', 403)
  }
}

/** Compose domain routes behind the shared request gate and HTTP error boundary. */
export function apiController(
  repository: LibraryRepository,
  options: { origin?: URL; workspaceId?: string } = {},
) {
  const concepts = new ConceptService(repository)
  const quizzes = new QuizService(repository)
  const reports = new ReportService(repository)
  const importer = new ImportService(repository, options.workspaceId)
  const library = new LibraryService(repository)
  const home = new HomeService(repository)
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    try {
      checkLocalRequest(request, options.origin)
      const url = new URL(request.url ?? '/', 'http://localhost')
      const result =
        (await conceptRoute(concepts, request, url, readJsonBody)) ??
        (await homeRoute(home, quizzes, request, url)) ??
        reportRoute(reports, quizzes, request, url) ??
        (await quizRoute(quizzes, request, url)) ??
        (await importRoute(importer, request, url)) ??
        libraryRoute(repository, library, request, url)
      if (result) {
        sendJson(response, result.status, result.value)
        return
      }
      throw new ApplicationError('Not found.', 404)
    } catch (error) {
      if (error instanceof ApplicationError)
        sendJson(response, error.status, {
          error: error.message.split('\n')[0],
          details: error.details,
        })
      else
        sendJson(response, 500, {
          error: 'The local operation failed. No partial import was saved.',
        })
    }
  }
}
