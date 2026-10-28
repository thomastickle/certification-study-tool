import { existsSync } from 'node:fs'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { resolve } from 'node:path'
import { securityFailure } from './security.filter.ts'
import type { AdmittedRequest } from './security-context.ts'
import { DevelopmentVite } from './development-vite.ts'
import type { RuntimeConfiguration } from './runtime-configuration.ts'
import type { RequestUrl } from './request-url.ts'
import { developmentWebHandler, staticWebHandler } from './web-handler.ts'

/** Own public assets and Vite before any fallible initialization hook runs. */
export class PublicWeb {
  private development = new DevelopmentVite()
  private pending = new Set<Promise<void>>()

  constructor(private handler?: ReturnType<typeof staticWebHandler>) {}

  /** Allocate public serving on the actual Nest listener without opening another HTTP port. */
  async initialize(server: Server, configuration: RuntimeConfiguration): Promise<void> {
    if (configuration.production) {
      if (!existsSync(resolve(configuration.staticRoot, 'index.html'))) {
        throw new Error('Run npm run build before starting production mode.')
      }
      this.handler = staticWebHandler(configuration.staticRoot)
    } else {
      const vite = await this.development.initialize(server)
      this.handler = developmentWebHandler((request, response) =>
        vite.middlewares(request, response),
      )
    }
  }

  /** Retain both the response and returned handler work, including work after disconnect. */
  async handle(request: IncomingMessage, response: ServerResponse, url: RequestUrl): Promise<void> {
    const completed = new Promise<void>((resolve) => {
      const done = () => {
        response.off('finish', done)
        response.off('close', done)
        resolve()
      }

      response.once('finish', done)
      response.once('close', done)
      if (response.destroyed || response.writableFinished) {
        done()
      }
    })

    const operation = (async () => {
      try {
        await this.handler!(request, response, url)
      } catch (error) {
        securityFailure(error, request as AdmittedRequest, response)
      }
      await completed
    })()
    this.pending.add(operation)
    try {
      await operation
    } finally {
      this.pending.delete(operation)
    }
  }

  /** Stop web allocation and HMR before HTTP connections are aborted. */
  close(): Promise<void> {
    return this.development.close()
  }

  /** Join response and handler work after the owner has unblocked HTTP connections. */
  async drain(): Promise<void> {
    while (this.pending.size) {
      await Promise.allSettled([...this.pending])
    }
  }
}
