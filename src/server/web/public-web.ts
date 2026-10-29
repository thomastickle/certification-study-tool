import { existsSync } from 'node:fs'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { resolve } from 'node:path'
import { securityFailure } from '../security/security.filter.ts'
import type { AdmittedRequest } from '../security/security-context.ts'
import type { RuntimeConfiguration } from '../runtime/runtime-configuration.ts'
import type { RequestUrl } from '../http/request-url.ts'
import { validateStaticAssets } from './validate-static-assets.ts'
import { staticWebHandler } from './web-handler.ts'

/** Own built public responses through their complete asynchronous work. */
export class PublicWeb {
  private pending = new Set<Promise<void>>()

  constructor(private handler?: ReturnType<typeof staticWebHandler>) {}

  /** Allocate public serving on the actual Nest listener without opening another HTTP port. */
  async initialize(_server: Server, configuration: RuntimeConfiguration): Promise<void> {
    if (!configuration.production) {
      throw new Error('Use DevelopmentApplication for process-isolated development serving.')
    }
    if (!existsSync(resolve(configuration.staticRoot, 'index.html'))) {
      throw new Error('Run npm run build before starting production mode.')
    }
    validateStaticAssets(configuration.staticRoot)
    this.handler = staticWebHandler(configuration.staticRoot)
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

  /** Retain the disposal hook for composed public handlers; static responses drain after HTTP abort. */
  close(): Promise<void> {
    return Promise.resolve()
  }

  /** Join response and handler work after the owner has unblocked HTTP connections. */
  async drain(): Promise<void> {
    while (this.pending.size) {
      await Promise.allSettled([...this.pending])
    }
  }
}
