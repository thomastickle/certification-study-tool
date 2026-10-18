import type { IncomingMessage, ServerResponse } from 'node:http'
import { ApplicationError } from './errors.ts'
import { ImportService } from './importer/import-service.ts'
import { LibraryRepository } from './questions/library-repository.ts'
import { LibraryService } from './questions/library-service.ts'

/** Prevent other websites from driving a local library through this server. */
export function checkLocalRequest(request: IncomingMessage): void {
  const port = request.socket.localPort
  const hosts = [`127.0.0.1:${port}`, `localhost:${port}`]
  if (!hosts.includes(request.headers.host ?? ''))
    throw new ApplicationError('Local access only.', 403)
  const origin = request.headers.origin
  if (
    (origin && !hosts.map((host) => `http://${host}`).includes(origin)) ||
    request.headers['sec-fetch-site'] === 'cross-site'
  ) {
    throw new ApplicationError('Cross-site requests are not allowed.', 403)
  }
}

function send(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  })
  response.end(JSON.stringify(value))
}

async function body(request: IncomingMessage): Promise<Record<string, unknown>> {
  if (!request.headers['content-type']?.startsWith('application/json'))
    throw new ApplicationError('Expected application/json.', 415)
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk)
    size += buffer.length
    if (size > 10 * 1024 * 1024)
      throw new ApplicationError('Files must be smaller than 10 MB.', 413)
    chunks.push(buffer)
  }
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error()
    return value as Record<string, unknown>
  } catch {
    throw new ApplicationError('Invalid JSON request. Nothing was imported.')
  }
}

function positiveInteger(text: string | null, fallback?: number): number {
  if (text === null && fallback !== undefined) return fallback
  if (!text || !/^[1-9]\d*$/.test(text) || !Number.isSafeInteger(Number(text)))
    throw new ApplicationError('Expected a positive integer.')
  return Number(text)
}

export function apiController(repository: LibraryRepository) {
  const importer = new ImportService(repository)
  const library = new LibraryService(repository)
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    try {
      checkLocalRequest(request)
      const url = new URL(request.url ?? '/', 'http://localhost')
      if (request.method === 'GET' && url.pathname === '/api/sources')
        return send(response, 200, repository.sources())
      if (request.method === 'GET' && url.pathname === '/api/questions') {
        const source = url.searchParams.get('sourceId')
        return send(
          response,
          200,
          repository.questions(
            source === null ? undefined : positiveInteger(source),
            url.searchParams.get('search') ?? '',
            positiveInteger(url.searchParams.get('page'), 1),
          ),
        )
      }
      if (request.method === 'POST' && url.pathname === '/api/imports/preview') {
        const input = await body(request)
        return send(response, 200, importer.preview(input.bank))
      }
      if (request.method === 'POST' && url.pathname === '/api/imports/confirm') {
        const input = await body(request)
        if (typeof input.token !== 'string' || typeof input.reviewed !== 'boolean')
          throw new ApplicationError('Preview token and review confirmation are required.')
        return send(response, 201, importer.confirm(input.bank, input.token, input.reviewed))
      }
      const match = url.pathname.match(/^\/api\/(questions|sources)\/(\d+)$/)
      if (request.method === 'DELETE' && match) {
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
