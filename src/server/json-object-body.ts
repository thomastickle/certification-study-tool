import type { IncomingMessage } from 'node:http'
import { ApplicationError } from './errors.ts'

/** Read the legacy object-only JSON contract after authorization, inside the personal scope.
 * @throws {ApplicationError} For unsupported media, bodies over 10 MiB or invalid object JSON.
 */
export async function jsonObjectBody(
  request: IncomingMessage,
  allowEmpty = false,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  if (
    allowEmpty &&
    !request.headers['transfer-encoding'] &&
    Number(request.headers['content-length'] ?? 0) === 0
  ) {
    return {}
  }
  if (!request.headers['content-type']?.startsWith('application/json')) {
    throw new ApplicationError('Expected application/json.', 415)
  }
  const chunks = signal ? await cancellableChunks(request, signal) : await legacyChunks(request)
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

/** Retain the legacy stream behavior for the unchanged production transport. */
async function legacyChunks(request: IncomingMessage): Promise<Buffer[]> {
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    const buffer = Buffer.from(chunk)
    size += buffer.length
    if (size > 10 * 1024 * 1024) {
      throw new ApplicationError('Files must be smaller than 10 MB.', 413)
    }
    chunks.push(buffer)
  }
  return chunks
}

/** Stop a pending Nest body read on sibling failure without destroying its intended error response. */
function cancellableChunks(request: IncomingMessage, signal: AbortSignal): Promise<Buffer[]> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    let settled = false

    const cleanup = () => {
      signal.removeEventListener('abort', aborted)
      request.off('readable', readable)
      request.off('end', ended)
      request.off('error', failed)
      request.off('close', closed)
    }

    const failed = (error: unknown) => {
      if (!settled) {
        settled = true
        cleanup()
        reject(error)
      }
    }

    const aborted = () => failed(signal.reason)

    const closed = () => {
      if (!request.readableEnded) {
        failed(new Error('The request body was interrupted.'))
      }
    }

    const ended = () => {
      if (!settled) {
        settled = true
        cleanup()
        resolve(chunks)
      }
    }

    const readable = () => {
      try {
        signal.throwIfAborted()
        let chunk: Buffer | null
        while ((chunk = request.read() as Buffer | null) !== null) {
          size += chunk.length
          if (size > 10 * 1024 * 1024) {
            throw new ApplicationError('Files must be smaller than 10 MB.', 413)
          }
          chunks.push(chunk)
        }
      } catch (error) {
        failed(error)
      }
    }

    request.on('readable', readable)
    request.once('end', ended)
    request.once('error', failed)
    request.once('close', closed)
    signal.addEventListener('abort', aborted, { once: true })
    readable()
    if (request.readableEnded) {
      ended()
    } else if (request.destroyed) {
      closed()
    }
  })
}
