import type { IncomingMessage, ServerResponse } from 'node:http'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve, extname, relative, sep } from 'node:path'
import type { RoutedHttpHandler } from '../http/routed-http-handler.ts'

type StaticMiddleware = (
  request: IncomingMessage,
  response: ServerResponse,
  next: (error?: unknown) => void,
) => void

const express = createRequire(import.meta.url)('express') as {
  static(root: string, options: Record<string, unknown>): StaticMiddleware
}

/** Configure standard file serving behind admission, retaining the legacy URL and header policy. */
export function staticWebHandler(root: string): RoutedHttpHandler {
  const types: Record<string, string> = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
  }
  const serve = express.static(root, {
    redirect: false,
    index: false,
    dotfiles: 'allow',
    etag: false,
    lastModified: false,
    cacheControl: false,
    acceptRanges: false,
    setHeaders(response: ServerResponse, file: string) {
      response.setHeader('Content-Type', types[extname(file)] ?? 'application/octet-stream')
      response.setHeader('X-Content-Type-Options', 'nosniff')
      response.setHeader('Cache-Control', 'no-cache')
    },
  })
  return (request, response, url) => {
    const notFound = (error?: unknown) => {
      if (response.destroyed || response.writableEnded) {
        return
      }
      // A failed read may already have a file Content-Length before headers flush.
      // Abort it rather than frame a short error body with that stale length.
      if (response.headersSent || (error && response.hasHeader('Content-Length'))) {
        response.destroy()
        return
      }
      response.writeHead(404)
      response.end('Not found.')
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405)
      response.end()
      return
    }
    try {
      let file = resolve(root, '.' + decodeURIComponent(url.pathname))
      if (!file.startsWith(root + sep) && file !== root) {
        throw new Error()
      }
      if (file === root || (!existsSync(file) && !extname(file))) {
        file = resolve(root, 'index.html')
      }
      // A middleware-local view avoids changing admitted headers or exposing the raw target.
      const admitted = Object.create(request) as IncomingMessage
      admitted.url = '/' + relative(root, file).split(sep).map(encodeURIComponent).join('/')
      admitted.headers = { ...request.headers }
      for (const name of Object.keys(admitted.headers)) {
        if (name.startsWith('if-')) {
          delete admitted.headers[name]
        }
      }
      serve(admitted, response, notFound)
    } catch {
      notFound()
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
