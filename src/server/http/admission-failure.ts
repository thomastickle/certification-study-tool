import type { ServerResponse } from 'node:http'
import { ApplicationError } from './errors.ts'

/** Serialize failures at the public admission boundary without importing authentication or Nest. */
export function admissionFailure(error: unknown, response: ServerResponse): void {
  const expected = error instanceof ApplicationError
  response.writeHead(expected ? error.status : 500, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  })
  response.end(
    JSON.stringify({
      error: expected ? error.message : 'The request could not be completed. Please retry.',
    }),
  )
}
