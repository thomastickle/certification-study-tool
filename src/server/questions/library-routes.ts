import type { IncomingMessage } from 'node:http'
import type { LibraryRepository } from './library-repository.ts'
import type { LibraryService } from './library-service.ts'
import { positiveInteger } from '../http-messages.ts'
import type { RouteResponse } from '../http-messages.ts'

/** Own library query identifiers and deletion without choosing or opening an account database. */
export function libraryRoute(
  repository: LibraryRepository,
  service: LibraryService,
  request: IncomingMessage,
  url: URL,
): RouteResponse | undefined {
  if (request.method === 'GET' && url.pathname === '/api/sources') {
    return { status: 200, value: repository.sources() }
  }
  if (request.method === 'GET' && url.pathname === '/api/questions') {
    const source = url.searchParams.get('sourceId')
    const sourceId = source === null ? undefined : positiveInteger(source)
    const search = url.searchParams.get('search') ?? ''
    const page = positiveInteger(url.searchParams.get('page'), 1)
    return {
      status: 200,
      value: repository.questions(sourceId, search, page),
    }
  }
  const match = url.pathname.match(/^\/api\/(questions|sources)\/(\d+)$/)
  if (request.method === 'DELETE' && match) {
    const id = positiveInteger(match[2]!)
    if (match[1] === 'questions') {
      service.deleteQuestion(id)
    } else {
      service.deleteSource(id)
    }
    return { status: 204 }
  }
  return undefined
}
