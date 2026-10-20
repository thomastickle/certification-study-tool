import type { IncomingMessage } from 'node:http'
import { ConceptService } from './concept-service.ts'

export type ConceptResponse = { status: number; value?: unknown }

/** Dispatch after the controller's local-request gate; use its bounded JSON reader. */
export async function conceptRoute(
  service: ConceptService,
  request: IncomingMessage,
  url: URL,
  body: (request: IncomingMessage) => Promise<Record<string, unknown>>,
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
      return { status: 201, value: service.save(await body(request)) }
    }
  }
  const group = url.pathname.match(/^\/api\/concepts\/([a-f0-9-]{36})$/)
  if (group && request.method === 'PUT') {
    return { status: 200, value: service.save(await body(request), group[1]) }
  }
  if (group && request.method === 'DELETE') {
    service.remove(group[1]!)
    return { status: 200, value: null }
  }
  const suggestion = url.pathname.match(/^\/api\/concept-suggestions\/([a-f0-9]{64})\/dismiss$/)
  if (suggestion && request.method === 'POST') {
    service.dismiss(suggestion[1]!)
    return { status: 200, value: null }
  }
  return undefined
}
