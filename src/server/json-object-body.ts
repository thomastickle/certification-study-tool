import type { IncomingMessage } from 'node:http'
import { ApplicationError } from './errors.ts'

/** Read the legacy object-only JSON contract after authorization, inside the personal scope.
 * @throws {ApplicationError} For unsupported media, bodies over 10 MiB or invalid object JSON.
 */
export async function jsonObjectBody(
  request: IncomingMessage,
  allowEmpty = false,
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
