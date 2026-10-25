import type { IncomingMessage } from 'node:http'
import type { QuizService } from './quiz-service.ts'
import { ApplicationError } from '../errors.ts'
import { readJsonBody } from '../http-messages.ts'
import type { RouteResponse } from '../http-messages.ts'

/** Own quiz query validation and lifecycle operations after the account boundary authorizes access. */
export async function quizRoute(
  service: QuizService,
  request: IncomingMessage,
  url: URL,
): Promise<RouteResponse | undefined> {
  const scope = {
    provider: url.searchParams.get('provider') ?? undefined,
    certification: url.searchParams.get('certification') ?? undefined,
  }
  if (request.method === 'GET' && url.pathname === '/api/quizzes/due') {
    const ids = url.searchParams.get('sourceIds')
    return {
      status: 200,
      value: service.due({
        ...scope,
        sourceFilter: url.searchParams.get('sourceFilter') ?? 'mixed',
        questionType: url.searchParams.get('questionType') ?? 'mixed',
        ...(ids === null ? {} : { sourceIds: ids.split(',').map(Number) }),
      }),
    }
  }
  if (url.pathname === '/api/quizzes') {
    if (request.method === 'GET') return { status: 200, value: service.recent(scope) }
    if (request.method === 'POST')
      return { status: 201, value: service.start(await readJsonBody(request)) }
  }
  if (request.method === 'GET' && url.pathname === '/api/quizzes/current') {
    const mode = url.searchParams.get('mode') ?? 'quiz'
    if (mode !== 'quiz' && mode !== 'exam' && mode !== 'review')
      throw new ApplicationError('Choose a valid practice mode.')
    return { status: 200, value: service.current(mode, scope) }
  }
  if (request.method === 'GET' && url.pathname === '/api/quizzes/deleted') {
    return { status: 200, value: service.deletedResults(scope) }
  }
  const match = url.pathname.match(
    /^\/api\/quizzes\/([a-f0-9-]{36})(?:\/(answers|submit|abandon|pause|resume|restore))?$/,
  )
  if (!match) return undefined
  const id = match[1]!
  const action = match[2]
  if (request.method === 'DELETE' && !action) {
    const permanent = url.searchParams.get('permanent')
    if (permanent !== null && permanent !== 'true' && permanent !== 'false')
      throw new ApplicationError('Choose a valid permanent deletion option.')
    return { status: 200, value: service.deleteResult(id, permanent === 'true') }
  }
  if (request.method === 'POST' && action === 'restore')
    return { status: 200, value: service.restoreResult(id) }
  if (request.method === 'GET' && !action) return { status: 200, value: service.get(id) }
  if (request.method === 'PUT' && action === 'answers')
    return { status: 200, value: service.save(id, await readJsonBody(request)) }
  if (request.method === 'POST' && action === 'submit')
    return { status: 200, value: service.submit(id, await readJsonBody(request)) }
  if (request.method === 'POST' && action === 'pause')
    return { status: 200, value: service.pause(id, await readJsonBody(request, true)) }
  if (request.method === 'POST' && action === 'resume')
    return { status: 200, value: service.resume(id) }
  if (request.method === 'POST' && action === 'abandon')
    return { status: 200, value: service.abandon(id) }
  return undefined
}
