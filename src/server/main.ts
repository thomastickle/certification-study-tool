import 'reflect-metadata'
import { runtimeConfiguration } from './runtime/runtime-configuration.ts'
import { createProductionApplication } from './production-application.ts'
import { DevelopmentApplication } from './web/development-application.ts'

const configuration = runtimeConfiguration(process.env)
const development = configuration.production ? undefined : new DevelopmentApplication(configuration)
const contextStarting = development
  ? development.backend
  : createProductionApplication(configuration)
if (development) {
  void development.failed
    .then(async (error) => {
      console.error(error.message)
      process.exitCode = 1
      await shutdown()
    })
    .catch(() => {
      console.error('Application shutdown failed.')
      process.exitCode = 1
    })
}
let startingTransport: Promise<unknown> | undefined
let closing: Promise<void> | undefined
let interrupted = false

/** Share shutdown between both signals and startup failure, retaining normal process handle drainage. */
function shutdown(): Promise<void> {
  closing ??= (async () => {
    // A signal during initialization waits for acquired web resources to become drainable.
    await development?.close()
    await startingTransport?.catch(() => undefined)
    const context = await contextStarting.catch(() => undefined)
    await context?.close()
  })().finally(() => {
    process.off('SIGINT', onSignal)
    process.off('SIGTERM', onSignal)
  })
  return closing
}

/** Keep both signal listeners installed until shutdown finishes, so repeated signals cannot interrupt it. */
function onSignal(): void {
  interrupted = true
  void shutdown().catch(() => {
    console.error('Application shutdown failed.')
    process.exitCode = 1
  })
}

process.on('SIGINT', onSignal)
process.on('SIGTERM', onSignal)

try {
  const context = await contextStarting
  if (!closing) {
    startingTransport = (async () => {
      if (development) {
        await development.start()
        return
      }
      await context.init()
      if (!closing) {
        await context.listen(configuration.port, configuration.host)
      }
    })()
    await startingTransport
  }
  if (closing) {
    await closing
  } else {
    console.log(`Certification Study Tool: ${configuration.origin.origin}`)
  }
} catch (error) {
  await shutdown()
  if (!interrupted) {
    throw error
  }
}
