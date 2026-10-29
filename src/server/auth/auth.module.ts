import { Module } from '@nestjs/common'
import { AuthenticationController } from './authentication.controller.ts'
import { SessionController } from './session.controller.ts'

/** Expose authentication routes using the runtime-owned workflow singleton. */
@Module({ controllers: [AuthenticationController, SessionController] })
export class AuthModule {}
