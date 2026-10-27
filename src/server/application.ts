import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { ExpressAdapter } from '@nestjs/platform-express'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { ApplicationModule } from './application.module.ts'

/** Create an unbound Nest application for composition and loopback HTTP tests.
 * @throws Rejects on initialization failure instead of terminating the caller's process.
 */
export function createApplication(): Promise<NestExpressApplication> {
  // Authorization must precede streaming body reads when feature guards are introduced.
  return NestFactory.create<NestExpressApplication>(ApplicationModule, new ExpressAdapter(), {
    bodyParser: false,
    abortOnError: false,
    logger: false,
  })
}
