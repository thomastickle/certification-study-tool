import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { SecurityExpressAdapter } from './security/security-express-adapter.ts'
import type { NestExpressApplication } from '@nestjs/platform-express'
import type { DynamicModule } from '@nestjs/common'
import type { Server, ServerResponse } from 'node:http'
import type { RuntimeConfiguration } from './runtime/runtime-configuration.ts'
import { ApplicationModule } from './application.module.ts'
import { RuntimeStartup } from './runtime/runtime-startup.ts'
import { ApplicationRuntime } from './runtime/application-runtime.ts'
import { ApplicationAuthentication } from './auth/application-authentication.ts'
import { SecurityRequestLifetime } from './security/security-lifetime.ts'
import { securityFailure } from './security/security.filter.ts'
import type { AdmittedRequest } from './security/security-context.ts'
import { ApplicationError } from './http/errors.ts'
import type { PublicWeb } from './web/public-web.ts'

/** Create one configured Nest transport with focused feature modules and optional public serving.
 * @throws Rejects creation/setup failures after cleaning the acquired resource graph.
 */
export async function createApplication(
  configuration: RuntimeConfiguration,
  features: DynamicModule['imports'] = [],
  publicWeb?: PublicWeb,
): Promise<NestExpressApplication> {
  const adapter = new SecurityExpressAdapter()
  const startup = new RuntimeStartup()
  const app = await NestFactory.create<NestExpressApplication>(
    ApplicationModule.register(configuration, features, startup),
    adapter,
    { bodyParser: false, abortOnError: false, logger: false },
  ).catch(async (error: unknown) => {
    await startup.closeFailedStartup()
    throw error
  })
  try {
    const authentication = app.get(ApplicationAuthentication)
    const lifetime = app.get(SecurityRequestLifetime)
    app.get(ApplicationRuntime).attachTransport(async () => {
      lifetime.stop()
      try {
        await publicWeb?.close()
      } finally {
        await Promise.all([lifetime.drain(app.getHttpServer() as Server), publicWeb?.drain()])
      }
    })
    adapter.installAdmission((incoming, response: ServerResponse, next: () => void) => {
      const request = incoming as AdmittedRequest
      try {
        if (!lifetime.accepting) {
          throw new ApplicationError('The request could not be completed. Please retry.', 503)
        }
        const url = authentication.admit(request)
        // Admission sees original authority and headers, before rewriting Express's routing target.
        request.admission = Object.freeze({
          url,
          user:
            url.pathname.startsWith('/api/') &&
            !(url.pathname === '/api/health' && request.method === 'GET')
              ? authentication.session(request)
              : undefined,
        })
        request.url = url.pathname + url.search
        response.setHeader(
          'Referrer-Policy',
          url.pathname.startsWith('/auth/') ? 'no-referrer' : 'same-origin',
        )
        response.setHeader('Cache-Control', 'no-store')
        response.setHeader('X-Content-Type-Options', 'nosniff')
        if (publicWeb && !url.pathname.startsWith('/api/') && !url.pathname.startsWith('/auth/')) {
          void publicWeb
            .handle(request, response, url)
            .catch((error: unknown) => securityFailure(error, request, response))
        } else {
          next()
        }
      } catch (error) {
        securityFailure(error, request, response)
      }
    })
    await publicWeb?.initialize(app.getHttpServer() as Server, configuration)
    return app
  } catch (error) {
    // A cleanup failure must not replace the setup error that caused this unwind.
    try {
      await app.close()
    } catch {
      console.error('Application setup cleanup failed.')
    }
    throw error
  }
}
