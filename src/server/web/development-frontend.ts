import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'
import type { Plugin } from 'vite'
import { admitRequest } from '../http/admit-request.ts'
import { admissionFailure } from '../http/admission-failure.ts'
import { ApplicationError } from '../http/errors.ts'

const [originText, host, port, target] = process.argv.slice(2)
const origin = new URL(originText!)
let accepting = true

/** Contain this detached group even when its main owner cannot clean up partial Vite startup. */
function loseOwner(): never {
  accepting = false
  try {
    process.kill(-process.pid, 'SIGKILL')
  } finally {
    process.exit(1)
  }
}

process.once('disconnect', loseOwner)
if (!process.connected) {
  loseOwner()
}

const admission: Plugin = {
  name: 'study-original-target-admission',
  configureServer(vite) {
    // Stock restart installs a fresh Node server. Admit before Connect can normalize the target.
    return () => {
      const server = vite.httpServer!
      for (const event of ['request', 'upgrade'] as const) {
        const listeners = server.listeners(event)
        server.removeAllListeners(event)
        server.on(
          event,
          (request: IncomingMessage, response: ServerResponse | Duplex, head?: Buffer) => {
            try {
              if (!accepting) {
                throw new ApplicationError('The request could not be completed. Please retry.', 503)
              }
              const url = admitRequest(request, origin)
              request.url = url.pathname + url.search
              if (event === 'request') {
                const http = response as ServerResponse
                http.setHeader('Cache-Control', 'no-store')
                http.setHeader('X-Content-Type-Options', 'nosniff')
                http.setHeader(
                  'Referrer-Policy',
                  url.pathname.startsWith('/auth/') ? 'no-referrer' : 'same-origin',
                )
              }
              for (const listener of listeners) {
                listener.call(server, request, response, head)
              }
            } catch (error) {
              if (event === 'request') {
                admissionFailure(error, response as ServerResponse)
              } else {
                const status = error instanceof ApplicationError ? error.status : 500
                response.end(`HTTP/1.1 ${status} Denied\r\nConnection: close\r\n\r\n`)
              }
            }
          },
        )
      }
    }
  },
}

process.on('message', (message: unknown) => {
  if (
    message &&
    typeof message === 'object' &&
    'command' in message &&
    message.command === 'stop'
  ) {
    accepting = false
    process.send?.({ event: 'stopped' })
  }
})

try {
  const { createServer } = await import('vite')
  const server = await createServer({
    plugins: [admission],
    server: {
      host,
      port: Number(port),
      strictPort: true,
      allowedHosts: [origin.hostname],
      proxy: {
        '/api/': { target, changeOrigin: false },
        '/auth/': { target, changeOrigin: false },
      },
    },
  })
  await server.listen()
  process.send?.({ event: 'ready' })
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Vite startup failed.')
  // The parent owns even partial Vite initialization, whose resources may precede createServer's result.
  process.send?.({ event: 'failed' })
  process.exitCode = 1
}
