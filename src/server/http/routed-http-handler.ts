import type { IncomingMessage, ServerResponse } from 'node:http'
import type { RequestUrl } from './request-url.ts'

export type RoutedHttpHandler = (
  request: IncomingMessage,
  response: ServerResponse,
  url: RequestUrl,
) => void | Promise<void>
