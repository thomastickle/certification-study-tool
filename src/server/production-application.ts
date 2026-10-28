import { PublicWeb } from './public-web.ts'
import { LibraryHttpModule } from './library-http/library-http.module.ts'
import { StudyHttpModule } from './study-http/study.module.ts'
import { createApplication } from './application.ts'
import type { RuntimeConfiguration } from './runtime-configuration.ts'

/** Compose the full product boundary from the configured application graph. */
export function createProductionApplication(configuration: RuntimeConfiguration) {
  return createApplication(configuration, [LibraryHttpModule, StudyHttpModule], new PublicWeb())
}
