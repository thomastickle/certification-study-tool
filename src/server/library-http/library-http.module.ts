import { Module } from '@nestjs/common'
import { LibraryController } from './library.controller.ts'
import { LibraryRouteGuard } from './library-route.guard.ts'

/** Compose with createApplication(config, [LibraryHttpModule]); never register a second runtime. */
@Module({ controllers: [LibraryController], providers: [LibraryRouteGuard] })
export class LibraryHttpModule {}
