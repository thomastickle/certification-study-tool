import type { NestExpressApplication } from '@nestjs/platform-express'
import type { SecurityRequestLifetime } from '../security/security-lifetime.ts'

/** Preserve the public Nest factory API while serializing startup and owning failure disposal. */
export function ownApplicationLifecycle(
  app: NestExpressApplication,
  lifetime: SecurityRequestLifetime,
  joinedStudyInputs: boolean,
): NestExpressApplication {
  const initialize = app.init.bind(app)
  const listen = app.listen.bind(app)
  const close = app.close.bind(app)
  let closing: Promise<void> | undefined
  const starting = new Set<Promise<unknown>>()

  /** Share disposal between init/listen failure and later callers; Nest closes HTTP once. */
  const closeApplication = (): Promise<void> => {
    lifetime.stop()
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
    if (starting.size) {
      throw new Error('Application startup is already in progress. Await init/listen sequentially.')
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
    if (starting.size) {
      throw new Error('Application startup is already in progress. Await init/listen sequentially.')
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
      if (property === 'useGlobalPipes' && joinedStudyInputs) {
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
