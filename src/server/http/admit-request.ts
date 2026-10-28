import type { IncomingMessage } from 'node:http'
import { checkLocalRequest } from './local-request.ts'
import { ApplicationError } from './errors.ts'
import { requestUrl } from './request-url.ts'
import type { RequestUrl } from './request-url.ts'

/** Admit the original Node target before any framework rewrites it, without opening account storage.
 * @throws {ApplicationError} For foreign authority, Host, Origin or prohibited cross-site requests.
 * @throws {TypeError} For an invalid absolute URL, preserving the existing unexpected-error contract.
 */
export function admitRequest(request: IncomingMessage, origin: URL): RequestUrl {
  const url = new URL(request.url ?? '/', origin)
  // Cross-site redirects from an issuer must reach both the callback and the public shell.
  const callback = url.pathname === '/auth/callback'
  const publicPage = !url.pathname.startsWith('/api/') && !url.pathname.startsWith('/auth/')
  const publicNavigation = request.method === 'GET' && (callback || publicPage)
  checkLocalRequest(request, origin, publicNavigation)
  if (url.origin !== origin.origin) {
    throw new ApplicationError('Invalid request URL.', 403)
  }
  return requestUrl(url)
}
