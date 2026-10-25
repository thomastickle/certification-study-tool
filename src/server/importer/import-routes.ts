import type { IncomingMessage } from 'node:http'
import type { ImportService } from './import-service.ts'
import { ApplicationError } from '../errors.ts'
import { readJsonBody } from '../http-messages.ts'
import type { RouteResponse } from '../http-messages.ts'

/** Validate import requests and retain the account-bound preview/confirmation workflow. */
export async function importRoute(
  service: ImportService,
  request: IncomingMessage,
  url: URL,
): Promise<RouteResponse | undefined> {
  if (request.method !== 'POST') return undefined
  if (url.pathname === '/api/imports/preview') {
    const input = await readJsonBody(request)
    return { status: 200, value: service.preview(input.bank) }
  }
  if (url.pathname === '/api/imports/confirm') {
    const input = await readJsonBody(request)
    if (typeof input.token !== 'string' || typeof input.reviewed !== 'boolean')
      throw new ApplicationError('Preview token and review confirmation are required.')
    return { status: 201, value: service.confirm(input.bank, input.token, input.reviewed) }
  }
  return undefined
}
