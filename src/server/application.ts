import 'reflect-metadata'
import { DiscoveryService, NestFactory } from '@nestjs/core'
import { SecurityExpressAdapter } from './security-express-adapter.ts'
import type { NestExpressApplication } from '@nestjs/platform-express'
import type { DynamicModule } from '@nestjs/common'
import type { Server, ServerResponse } from 'node:http'
import type { RuntimeConfiguration } from './runtime-configuration.ts'
import { ApplicationModule } from './application.module.ts'
import { RuntimeStartup } from './runtime.module.ts'
import { ApplicationRuntime } from './application-runtime.ts'
import { ApplicationAuthentication } from './auth/application-authentication.ts'
import { SecurityRequestLifetime } from './security-lifetime.ts'
import { securityFailure } from './security.filter.ts'
import type { AdmittedRequest } from './security-context.ts'
import { registerStudyInputs } from './study-input-registration.ts'
import { ApplicationError } from './errors.ts'

/** Create the staged Nest transport; production retains the complete legacy router until stage four.
 * @throws Rejects initialization/listen failures after cleaning the acquired resource graph.
 */
export async function createApplication(
  configuration: RuntimeConfiguration,
  features: DynamicModule['imports'] = [],
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
    registerStudyInputs(app.get(DiscoveryService))
  } catch (error) {
    await app.close()
    throw error
  }
  const authentication = app.get(ApplicationAuthentication)
  const lifetime = app.get(SecurityRequestLifetime)
  app.get(ApplicationRuntime).attachTransport(() => lifetime.drain(app.getHttpServer() as Server))
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
      next()
    } catch (error) {
      securityFailure(error, request, response)
    }
  })
  const initialize = app.init.bind(app)
  const listen = app.listen.bind(app)
  const close = app.close.bind(app)
  let closing: Promise<void> | undefined
  const starting = new Set<Promise<unknown>>()

  /** Share disposal between init/listen failure and later callers; Nest closes HTTP once. */
  const closeApplication = (): Promise<void> => {
    closing ??= (async () => {
      await Promise.allSettled([...starting])
      await close()
    })()
    return closing
  }

  const initializeApplication = async () => {
    if (closing) {
      throw new Error('The application is closing.')
    }
    const operation = initialize()
    starting.add(operation)
    try {
      await operation
      return application
    } catch (error) {
      await closeApplication()
      throw error
    } finally {
      starting.delete(operation)
    }
  }

  const listenApplication = async (
    port: number | string,
    hostnameOrCallback?: string | (() => void),
    callback?: () => void,
  ) => {
    if (closing) {
      throw new Error('The application is closing.')
    }
    const operation =
      typeof hostnameOrCallback === 'string'
        ? listen(port, hostnameOrCallback, callback)
        : listen(port, hostnameOrCallback)
    starting.add(operation)
    try {
      return await operation
    } catch (error) {
      await closeApplication()
      throw error
    } finally {
      starting.delete(operation)
    }
  }

  // NestFactory returns its own proxy; assigning methods on it does not replace the target.
  // Keep failure ownership at this public factory boundary without changing Nest internals.
  const application = new Proxy(app, {
    get(target, property) {
      if (property === 'useGlobalPipes') {
        return () => {
          throw new Error(
            'Use parameter-local pipe instances on study inputs; global pipes are not supported.',
          )
        }
      }
      if (property === 'init') {
        return initializeApplication
      }
      if (property === 'listen') {
        return listenApplication
      }
      if (property === 'close') {
        return closeApplication
      }
      const value = Reflect.get(target, property)
      if (typeof value !== 'function') {
        return value
      }
      return (...args: unknown[]) => {
        const result = value(...args)
        return result === app ? application : result
      }
    },
  })
  return application
}
