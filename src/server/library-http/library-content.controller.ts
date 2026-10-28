import { Controller, Delete, HttpCode } from '@nestjs/common'

import { LibraryService } from '../questions/library-service.ts'
import {
  StudyContext,
  StudyRequest,
  LibraryWrite,
  OriginalPath,
} from '../security/security-context.ts'
import type { StudyRequestContext } from '../security/security-context.ts'
import { positiveInteger, visibility, repository } from './library-context.ts'
import { route } from './library-route.ts'

/** Share operations without duplicating route or import logic between content namespaces. */
@StudyRequest()
abstract class LibraryContentOperations {
  /** Retain deletion validation and domain side effects in LibraryService. */
  @Delete(['questions/:id', 'sources/:id'])
  @OriginalPath(/^\/api\/(?:shared\/|private\/)?(questions|sources)\/\d+$/)
  @HttpCode(204)
  deleteItem(@StudyContext() context: StudyRequestContext) {
    const [resource, rawId] = route(context.url.pathname).split('/')
    const id = positiveInteger(rawId!)
    const library = new LibraryService(repository(context), visibility(context))
    if (resource === 'questions') {
      library.deleteQuestion(id)
    } else {
      library.deleteSource(id)
    }
  }
}

/** Declare shared write policy on the concrete Nest route owner. */
@Controller(['api', 'api/shared'])
@LibraryWrite('shared')
export class SharedLibraryContentController extends LibraryContentOperations {}

/** Declare private write policy on the concrete Nest route owner. */
@Controller('api/private')
@LibraryWrite('private')
export class PrivateLibraryContentController extends LibraryContentOperations {}
