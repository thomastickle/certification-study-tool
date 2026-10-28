import { jsonObjectBody as body } from './json-object-body.ts'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { RequestUrl } from './request-url.ts'
import { ConceptService } from './concepts/concept-service.ts'
import { conceptRoute } from './concepts/concept-routes.ts'
import { ReportService } from './reports/report-service.ts'
import { QuizService } from './quizzes/quiz-service.ts'
import { ApplicationError } from './errors.ts'
import { ImportService } from './importer/import-service.ts'
import { LibraryRepository } from './questions/library-repository.ts'
import { LibraryService } from './questions/library-service.ts'
import { HomeService } from './home/home-service.ts'
import type { SessionUser } from '../shared/auth-contracts.ts'
import { ImportPreviews } from './importer/import-previews.ts'
import { parseLibraryItemId } from '../shared/library-identity.ts'

import { checkLocalRequest } from './local-request.ts'

export { checkLocalRequest } from './local-request.ts'

function send(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  })
  response.end(JSON.stringify(value))
}

function positiveInteger(text: string | null, fallback?: number): number {
  if (text === null && fallback !== undefined) return fallback
  if (!text || !/^[1-9]\d*$/.test(text) || !Number.isSafeInteger(Number(text)))
    throw new ApplicationError('Expected a positive integer.')
  return Number(text)
}

/** Bind personal queries to the authenticated actor and protect shared-content mutations. */
export function apiController(
  repository: LibraryRepository,
  actor: Pick<SessionUser, 'id' | 'role'>,
  origin?: URL,
  previews = new ImportPreviews(),
  privateLibrary?: LibraryRepository,
) {
  const combined = privateLibrary ? repository.forAccount(actor.id, privateLibrary) : undefined
  const personal = combined ?? repository.forAccount(actor.id)
  const quizzes = new QuizService(personal)
  const reports = new ReportService(personal)
  const home = new HomeService(personal)
  return async (
    request: IncomingMessage,
    response: ServerResponse,
    context: RequestUrl,
  ): Promise<void> => {
    try {
      checkLocalRequest(request, origin)
      combined?.synchronizeDeletions()
      const prefix = context.pathname.match(/^\/api\/(shared|private)\//)
      // Prefix routing and query parsing belong to this consumer, never the admitted snapshot.
      const url = {
        pathname: prefix ? '/api/' + context.pathname.slice(prefix[0].length) : context.pathname,
        searchParams: new URLSearchParams(context.search),
      }
      const visibility = prefix?.[1] === 'private' ? 'private' : 'shared'
      if (prefix) {
        if (
          !/^\/api\/(imports|questions|sources|concepts|concept-suggestions)(\/|$)/.test(
            url.pathname,
          )
        ) {
          throw new ApplicationError('Not found.', 404)
        }
      }
      const content = visibility === 'private' ? privateLibrary : repository
      if (!content) {
        throw new ApplicationError('Private library is unavailable.', 404)
      }
      const concepts = new ConceptService(content.forAccount(actor.id))
      const importer = new ImportService(content)
      const library = new LibraryService(content, visibility)

      /** Authorize before reading a mutation body or consuming a preview ticket.
       * @throws {ApplicationError} When a verified student targets shared content.
       */
      const authorizeLibraryWrite = (): void => {
        if (visibility === 'shared' && actor.role !== 'admin') {
          throw new ApplicationError('Only an administrator can change shared question banks.', 403)
        }
      }

      const scope = {
        provider: url.searchParams.get('provider') ?? undefined,
        certification: url.searchParams.get('certification') ?? undefined,
      }
      const conceptResponse = await conceptRoute(
        concepts,
        request,
        url,
        body,
        authorizeLibraryWrite,
      )
      if (conceptResponse) {
        return send(response, conceptResponse.status, conceptResponse.value)
      }
      if (request.method === 'GET' && url.pathname === '/api/home') {
        quizzes.expireDue()
        return send(response, 200, home.get())
      }
      if (request.method === 'PUT' && url.pathname === '/api/certifications/earned') {
        quizzes.expireDue()
        return send(response, 200, home.setEarned(await body(request)))
      }
      if (request.method === 'GET' && url.pathname === '/api/reports') {
        quizzes.expireDue()
        return send(
          response,
          200,
          reports.get({
            mode: url.searchParams.get('mode'),
            days: url.searchParams.get('days'),
            ...scope,
          }),
        )
      }
      if (request.method === 'GET' && url.pathname === '/api/quizzes/due') {
        const ids = url.searchParams.get('sourceIds')
        return send(
          response,
          200,
          quizzes.due({
            ...scope,
            sourceFilter: url.searchParams.get('sourceFilter') ?? 'mixed',
            questionType: url.searchParams.get('questionType') ?? 'mixed',
            ...(ids === null ? {} : { sourceIds: ids.split(',').map(parseLibraryItemId) }),
          }),
        )
      }
      if (url.pathname === '/api/quizzes') {
        if (request.method === 'GET') return send(response, 200, quizzes.recent(scope))
        if (request.method === 'POST')
          return send(response, 201, quizzes.start(await body(request)))
      }
      if (request.method === 'GET' && url.pathname === '/api/quizzes/current') {
        const mode = url.searchParams.get('mode') ?? 'quiz'
        if (mode !== 'quiz' && mode !== 'exam' && mode !== 'review')
          throw new ApplicationError('Choose a valid practice mode.')
        return send(response, 200, quizzes.current(mode, scope))
      }
      if (request.method === 'GET' && url.pathname === '/api/quizzes/deleted') {
        return send(response, 200, quizzes.deletedResults(scope))
      }
      const quizRoute = url.pathname.match(
        /^\/api\/quizzes\/([a-f0-9-]{36})(?:\/(answers|submit|abandon|pause|resume|restore))?$/,
      )
      if (quizRoute) {
        const id = quizRoute[1]!
        if (request.method === 'DELETE' && !quizRoute[2]) {
          const permanent = url.searchParams.get('permanent')
          if (permanent !== null && permanent !== 'true' && permanent !== 'false') {
            throw new ApplicationError('Choose a valid permanent deletion option.')
          }
          return send(response, 200, quizzes.deleteResult(id, permanent === 'true'))
        }
        if (request.method === 'POST' && quizRoute[2] === 'restore') {
          return send(response, 200, quizzes.restoreResult(id))
        }
        if (request.method === 'GET' && !quizRoute[2]) return send(response, 200, quizzes.get(id))
        if (request.method === 'PUT' && quizRoute[2] === 'answers')
          return send(response, 200, quizzes.save(id, await body(request)))
        if (request.method === 'POST' && quizRoute[2] === 'submit')
          return send(response, 200, quizzes.submit(id, await body(request)))
        if (request.method === 'POST' && quizRoute[2] === 'pause')
          return send(response, 200, quizzes.pause(id, await body(request, true)))
        if (request.method === 'POST' && quizRoute[2] === 'resume')
          return send(response, 200, quizzes.resume(id))
        if (request.method === 'POST' && quizRoute[2] === 'abandon')
          return send(response, 200, quizzes.abandon(id))
      }
      if (request.method === 'GET' && url.pathname === '/api/sources')
        return send(response, 200, prefix ? content.sources() : personal.sources())
      if (request.method === 'GET' && url.pathname === '/api/questions') {
        const source = url.searchParams.get('sourceId')
        return send(
          response,
          200,
          content.questions(
            source === null ? undefined : positiveInteger(source),
            url.searchParams.get('search') ?? '',
            positiveInteger(url.searchParams.get('page'), 1),
          ),
        )
      }
      if (request.method === 'POST' && url.pathname === '/api/imports/preview') {
        authorizeLibraryWrite()
        const input = await body(request)
        const preview = importer.preview(input.bank)
        const token = previews.issue(actor.id, preview.token, visibility)
        return send(response, 200, { ...preview, token })
      }
      if (request.method === 'POST' && url.pathname === '/api/imports/confirm') {
        authorizeLibraryWrite()
        const input = await body(request)
        if (typeof input.token !== 'string' || typeof input.reviewed !== 'boolean')
          throw new ApplicationError('Preview token and review confirmation are required.')
        const contentToken = previews.consume(actor.id, input.token, visibility)
        const imported = importer.confirm(input.bank, contentToken, input.reviewed)
        return send(response, 201, { ...imported, token: input.token })
      }
      const match = url.pathname.match(/^\/api\/(questions|sources)\/(\d+)$/)
      if (request.method === 'DELETE' && match) {
        authorizeLibraryWrite()
        const id = positiveInteger(match[2]!)
        if (match[1] === 'questions') library.deleteQuestion(id)
        else library.deleteSource(id)
        response.writeHead(204, { 'Cache-Control': 'no-store' })
        response.end()
        return
      }
      throw new ApplicationError('Not found.', 404)
    } catch (error) {
      if (error instanceof ApplicationError)
        send(response, error.status, {
          error: error.message.split('\n')[0],
          details: error.details,
        })
      else
        send(response, 500, { error: 'The local operation failed. No partial import was saved.' })
    }
  }
}
