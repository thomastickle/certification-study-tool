import type { IncomingMessage, ServerResponse } from 'node:http'
import { existsSync, statSync, createReadStream } from 'node:fs'
import { resolve, extname, sep } from 'node:path'
import { pipeline } from 'node:stream/promises'
import type { RoutedHttpHandler } from '../http/routed-http-handler.ts'

/** Serve the built shell and assets within the configured distribution directory. */
export function staticWebHandler(root: string): RoutedHttpHandler {
  return async (request, response, url) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405)
      response.end()
      return
    }
    try {
      const pathname = decodeURIComponent(url.pathname)
      let file = resolve(root, '.' + pathname)
      if (!file.startsWith(root + sep) && file !== root) throw new Error()
      if (file === root) file = resolve(root, 'index.html')
      if (!existsSync(file) && !extname(file)) file = resolve(root, 'index.html')
      if (!statSync(file).isFile()) throw new Error()
      const types: Record<string, string> = {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.svg': 'image/svg+xml',
        '.ico': 'image/x-icon',
      }
      response.writeHead(200, {
        'Content-Type': types[extname(file)] ?? 'application/octet-stream',
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-cache',
      })
      if (request.method === 'HEAD') response.end()
      else await pipeline(createReadStream(file), response)
    } catch {
      if (response.destroyed || response.writableEnded) {
        return
      }
      if (response.headersSent) {
        response.destroy()
        return
      }
      response.writeHead(404)
      response.end('Not found.')
    }
  }
}

/** Adapt the admitted route for middleware that reads Node's request target. */
export function developmentWebHandler(
  middleware: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>,
): RoutedHttpHandler {
  return (request, response, url) => {
    request.url = url.pathname + url.search
    return middleware(request, response)
  }
}
