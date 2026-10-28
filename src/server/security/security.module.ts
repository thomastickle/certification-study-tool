import { Module } from '@nestjs/common'
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, DiscoveryModule } from '@nestjs/core'
import { SecurityGuard } from './security.guard.ts'
import { SecurityExceptionFilter } from './security.filter.ts'
import { StudyContextInterceptor } from './study-context.interceptor.ts'
import { SecurityRequestLifetime } from './security-lifetime.ts'

/** Compose the security boundary once; runtime providers come from the configured global graph. */
@Module({
  imports: [DiscoveryModule],
  providers: [
    SecurityGuard,
    SecurityRequestLifetime,
    { provide: APP_GUARD, useExisting: SecurityGuard },
    { provide: APP_FILTER, useClass: SecurityExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: StudyContextInterceptor },
  ],
  exports: [SecurityRequestLifetime],
})
export class SecurityModule {}
