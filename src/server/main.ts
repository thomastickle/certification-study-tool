import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { ApplicationRuntime } from './application-runtime.ts'
import { runtimeConfiguration } from './runtime-configuration.ts'
import { RuntimeModule } from './runtime.module.ts'
import { startLegacyTransport } from './legacy-transport.ts'

const configuration = runtimeConfiguration(process.env)
const contextStarting = NestFactory.createApplicationContext(
  RuntimeModule.register(configuration),
  {
    abortOnError: false,
    logger: false,
  },
)
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
    startingTransport = startLegacyTransport(context.get(ApplicationRuntime), configuration)
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
