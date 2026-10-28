import { JsonBodyInterceptor } from '../security/json-body.interceptor.ts'
import { Module } from '@nestjs/common'
import { LibraryBrowseController } from './library-browse.controller.ts'
import {
  SharedLibraryImportController,
  PrivateLibraryImportController,
} from './library-import.controller.ts'
import {
  SharedLibraryContentController,
  PrivateLibraryContentController,
} from './library-content.controller.ts'
import { SharedConceptController, PrivateConceptController } from './concept.controller.ts'

/** Register resource controllers; the root security guard owns metadata-driven write policy. */
@Module({
  providers: [JsonBodyInterceptor],
  controllers: [
    LibraryBrowseController,
    SharedLibraryImportController,
    PrivateLibraryImportController,
    SharedLibraryContentController,
    PrivateLibraryContentController,
    SharedConceptController,
    PrivateConceptController,
  ],
})
export class LibraryHttpModule {}
