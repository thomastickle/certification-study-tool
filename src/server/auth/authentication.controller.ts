import { Controller, Get, Inject, Post, Req, Res } from '@nestjs/common'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { ApplicationAuthentication } from './application-authentication.ts'
import { NormalizedUrl, PublicMethod } from '../security/security-context.ts'

import type { RequestUrl } from '../http/request-url.ts'

/** Reuse the single protocol/workflow owner without dispatching on legacy route pathnames. */
@Controller('auth')
export class AuthenticationController {
  constructor(
    @Inject(ApplicationAuthentication) private readonly authentication: ApplicationAuthentication,
  ) {}

  /** Reserve a browser-bound login through the existing OIDC workflow. */
  @Get('login')
  @PublicMethod('GET')
  login(@Req() request: IncomingMessage, @Res() response: ServerResponse): Promise<void> {
    return this.authentication.startLogin(request, response)
  }

  /** Complete the transaction using the immutable admitted query. */
  @Get('callback')
  @PublicMethod('GET')
  callback(
    @Req() request: IncomingMessage,
    @Res() response: ServerResponse,
    @NormalizedUrl() url: RequestUrl,
  ): Promise<void> {
    return this.authentication.completeLogin(request, response, url)
  }

  /** Revoke local access before awaiting provider logout discovery. */
  @Post('logout')
  @PublicMethod('POST')
  logout(@Req() request: IncomingMessage, @Res() response: ServerResponse): Promise<void> {
    return this.authentication.logout(request, response)
  }
}
