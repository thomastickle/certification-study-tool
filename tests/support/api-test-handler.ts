import type { IncomingMessage, ServerResponse } from 'node:http'
import { apiController } from '../../src/server/http-controller.ts'
import { requestUrl } from '../../src/server/request-url.ts'

/** Adapt isolated controller tests with fixed synthetic actors, without simulating authentication. */
export function apiTestHandler(...options: Parameters<typeof apiController>) {
  const controller = apiController(...options)
  return (request: IncomingMessage, response: ServerResponse) => {
    const url = requestUrl(new URL(request.url ?? '/', 'http://localhost'))
    return controller(request, response, url)
  }
}
