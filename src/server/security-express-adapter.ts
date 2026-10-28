import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { createRequire } from 'node:module'
import { NotFoundException } from '@nestjs/common'
import { ExpressAdapter } from '@nestjs/platform-express'

/** Set matching policy before the adapter's constructor creates Express's lazy router. */
export class SecurityExpressAdapter extends ExpressAdapter {
  constructor() {
    const express = createRequire(import.meta.url)('express') as () => {
      set(name: string, value: boolean): void
      disable(name: string): void
    }
    const instance = express()
    instance.set('trust proxy', false)
    instance.set('case sensitive routing', true)
    instance.set('strict routing', true)
    instance.disable('x-powered-by')
    super(instance)
  }

  /** Admit original targets before Express can skip middleware for a malformed absolute URL. */
  installAdmission(
    admit: (request: IncomingMessage, response: ServerResponse, next: () => void) => void,
  ): void {
    const server = this.getHttpServer() as Server
    const listeners = server.listeners('request')
    const dispatch = listeners[0]
    if (listeners.length !== 1 || !dispatch) {
      throw new Error('Expected the owned Nest Express request listener before admission setup.')
    }
    server.removeListener(
      'request',
      dispatch as (request: IncomingMessage, response: ServerResponse) => void,
    )
    server.on('request', (request, response) => {
      admit(request, response, () => {
        dispatch.call(server, request, response)
      })
    })
  }

  /** Invalid encoded parameters are route misses, still subject to API auth/workspace admission. */
  mapException(error: unknown): unknown {
    if (error instanceof URIError) {
      return new NotFoundException()
    }
    return super.mapException(error)
  }
}
