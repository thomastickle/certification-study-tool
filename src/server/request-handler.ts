import type { IncomingMessage, ServerResponse } from 'node:http'
import type { ApplicationAuthentication } from './auth/application-authentication.ts'
import type { RequestUrl } from './request-url.ts'
import type { SessionUser } from '../shared/auth-contracts.ts'

type HttpHandler = (request: IncomingMessage, response: ServerResponse) => void | Promise<void>

export type RoutedHttpHandler = (
  request: IncomingMessage,
  response: ServerResponse,
  url: RequestUrl,
) => void | Promise<void>

export type ApplicationHandlers = {
  authentication: Pick<ApplicationAuthentication, 'handle'>
  study: (user: SessionUser) => RoutedHttpHandler
  web: RoutedHttpHandler
}

/** Use the authenticated route/actor and contain failures before Node discards the handler promise. */
export function applicationRequestHandler(handlers: ApplicationHandlers): HttpHandler {
  return async (request, response) => {
    try {
      const context = await handlers.authentication.handle(request, response)
      if (context.route === 'handled') {
        return
      }
      if (context.route === 'study') {
        const api = handlers.study(context.user)
        await api(request, response, context.url)
        return
      }
      await handlers.web(request, response, context.url)
    } catch {
      console.error('An HTTP request could not be completed.')
      if (response.destroyed || response.writableEnded) {
        return
      }
      if (response.headersSent) {
        response.destroy()
        return
      }
      response.writeHead(500, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      })
      response.end(JSON.stringify({ error: 'The request could not be completed. Please retry.' }))
    }
  }
}
