import type { IncomingMessage } from 'node:http'
import { ConceptService } from './concept-service.ts'

export type ConceptResponse = { status: number; value?: unknown }

/** Dispatch reads freely; authorize each write before reading its body or changing content. */
export async function conceptRoute(
  service: ConceptService,
  request: IncomingMessage,
  url: Pick<URL, 'pathname'>,
  body: (request: IncomingMessage) => Promise<Record<string, unknown>>,
  authorizeLibraryWrite: () => void,
): Promise<ConceptResponse | undefined> {
  if (url.pathname === '/api/concepts') {
    if (request.method === 'GET') {
      return {
        status: 200,
        value: {
          groups: service.groups(),
          suggestions: service.suggestions(),
          library: service.library(),
        },
      }
    }
    if (request.method === 'POST') {
      authorizeLibraryWrite()
      return { status: 201, value: service.save(await body(request)) }
    }
  }
  const group = url.pathname.match(/^\/api\/concepts\/([a-f0-9-]{36})$/)
  if (group && request.method === 'PUT') {
    authorizeLibraryWrite()
    return { status: 200, value: service.save(await body(request), group[1]) }
  }
  if (group && request.method === 'DELETE') {
    authorizeLibraryWrite()
    service.remove(group[1]!)
    return { status: 200, value: null }
  }
  const suggestion = url.pathname.match(/^\/api\/concept-suggestions\/([a-f0-9]{64})\/dismiss$/)
  if (suggestion && request.method === 'POST') {
    authorizeLibraryWrite()
    service.dismiss(suggestion[1]!)
    return { status: 200, value: null }
  }
  return undefined
}
