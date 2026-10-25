import type { IncomingMessage, ServerResponse } from 'node:http'
import { ApplicationError } from './errors.ts'

export type RouteResponse = { status: number; value?: unknown }

/** Read a bounded JSON object, optionally accepting an empty request for pause operations. */
export async function readJsonBody(
  request: IncomingMessage,
  allowEmpty = false,
): Promise<Record<string, unknown>> {
  const chunked = Boolean(request.headers['transfer-encoding'])
  const contentLength = Number(request.headers['content-length'] ?? 0)
  if (allowEmpty && !chunked && contentLength === 0) {
    return {}
  }
  if (!request.headers['content-type']?.startsWith('application/json')) {
    throw new ApplicationError('Expected application/json.', 415)
  }
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk)
    size += buffer.length
    if (size > 10 * 1024 * 1024) {
      throw new ApplicationError('Files must be smaller than 10 MB.', 413)
    }
    chunks.push(buffer)
  }
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error()
    }
    return value as Record<string, unknown>
  } catch {
    throw new ApplicationError('Invalid JSON request. Nothing was imported.')
  }
}

/** Reject malformed, nonpositive, or unsafe numeric query and path identifiers. */
export function positiveInteger(text: string | null, fallback?: number): number {
  if (text === null && fallback !== undefined) {
    return fallback
  }
  if (!text || !/^[1-9]\d*$/.test(text) || !Number.isSafeInteger(Number(text))) {
    throw new ApplicationError('Expected a positive integer.')
  }
  return Number(text)
}

/** Serialize domain results and preserve empty 204 responses. */
export function sendJson(response: ServerResponse, status: number, value: unknown): void {
  if (status === 204) {
    response.writeHead(204, { 'Cache-Control': 'no-store' })
    response.end()
    return
  }
  response.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  })
  response.end(JSON.stringify(value))
}
