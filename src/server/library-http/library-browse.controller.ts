import { Controller, Get } from '@nestjs/common'

import { StudyContext, StudyRequest, OriginalPath } from '../security/security-context.ts'
import type { StudyRequestContext } from '../security/security-context.ts'
import { positiveInteger, repository, conceptService } from './library-context.ts'

/** Browse either namespace through the same verified personal scope. */
@Controller(['api', 'api/shared', 'api/private'])
@StudyRequest()
export class LibraryBrowseController {
  /** Unprefixed sources combine both libraries; explicit aliases list only selected content. */
  @Get('sources')
  @OriginalPath(/^\/api\/(?:shared\/|private\/)?sources$/)
  sources(@StudyContext() context: StudyRequestContext) {
    if (context.url.pathname === '/api/sources') {
      return context.study.sources()
    }
    return repository(context).sources()
  }

  /** Preserve first-query-value paging, search and local numeric source IDs. */
  @Get('questions')
  @OriginalPath(/^\/api\/(?:shared\/|private\/)?questions$/)
  questions(@StudyContext() context: StudyRequestContext) {
    const source = context.query.get('sourceId')
    return repository(context).questions(
      source === null ? undefined : positiveInteger(source),
      context.query.get('search') ?? '',
      positiveInteger(context.query.get('page'), 1),
    )
  }

  /** Return the selected concept review catalog. */
  @Get('concepts')
  @OriginalPath(/^\/api\/(?:shared\/|private\/)?concepts$/)
  concepts(@StudyContext() context: StudyRequestContext) {
    const service = conceptService(context)
    return {
      groups: service.groups(),
      suggestions: service.suggestions(),
      library: service.library(),
    }
  }
}
