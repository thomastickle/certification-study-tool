import 'reflect-metadata'
import { runtimeConfiguration } from './runtime/runtime-configuration.ts'
import { createProductionApplication } from './production-application.ts'

const configuration = runtimeConfiguration(process.env)
const contextStarting = createProductionApplication(configuration)
let startingTransport: Promise<unknown> | undefined
let closing: Promise<void> | undefined

/** Share shutdown between both signals and startup failure, retaining normal process handle drainage. */
function shutdown(): Promise<void> {
  closing ??= (async () => {
    // A signal during initialization waits for acquired web resources to become drainable.
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
  throw error
}
