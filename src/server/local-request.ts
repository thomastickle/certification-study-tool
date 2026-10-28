import type { IncomingMessage } from 'node:http'
import { ApplicationError } from './errors.ts'

/** Prevent other websites from driving a local library through this server. */
export function checkLocalRequest(
  request: IncomingMessage,
  publicOrigin?: URL,
  publicNavigation = false,
): void {
  const port = request.socket.localPort
  const hosts = publicOrigin ? [publicOrigin.host] : [`127.0.0.1:${port}`, `localhost:${port}`]
  if (!hosts.includes(request.headers.host ?? '')) {
    throw new ApplicationError('Local access only.', 403)
  }
  const origin = request.headers.origin
  const origins = publicOrigin ? [publicOrigin.origin] : hosts.map((host) => `http://${host}`)
  const foreignOrigin = origin && !origins.includes(origin)
  const crossSite = !publicNavigation && request.headers['sec-fetch-site'] === 'cross-site'
  const mutation = !['GET', 'HEAD'].includes(request.method ?? '')
  const missingMutationOrigin = publicOrigin && mutation && origin !== publicOrigin.origin
  if (foreignOrigin || crossSite || missingMutationOrigin) {
    throw new ApplicationError('Cross-site requests are not allowed.', 403)
  }
}
