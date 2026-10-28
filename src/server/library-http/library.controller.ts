import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Post,
  Put,
  Header,
  UseGuards,
} from '@nestjs/common'

import { ApplicationError } from '../http/errors.ts'
import { ConceptService } from '../concepts/concept-service.ts'
import { ImportService } from '../importer/import-service.ts'
import { ImportPreviews } from '../importer/import-previews.ts'
import { LibraryService } from '../questions/library-service.ts'
import { JsonObjectBody, StudyContext, StudyRequest } from '../security/security-context.ts'
import type { StudyRequestContext } from '../security/security-context.ts'

import { LibraryRouteGuard } from './library-route.guard.ts'
import { route } from './library-route.ts'

/** Preserve digits-first route matching followed by positive safe-integer validation. */
function positiveInteger(value: string | null, fallback?: number): number {
  if (value === null && fallback !== undefined) {
    return fallback
  }
  if (!value || !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) {
    throw new ApplicationError('Expected a positive integer.')
  }
  return Number(value)
}

/** Select content from the admitted namespace, never from client-supplied account IDs. */
function visibility(context: StudyRequestContext): 'private' | 'shared' {
  return context.url.pathname.startsWith('/api/private/') ? 'private' : 'shared'
}

/** Focused content endpoints; repositories are borrowed only for the awaited request scope. */
@Controller(['api', 'api/shared', 'api/private'])
@StudyRequest()
@UseGuards(LibraryRouteGuard)
export class LibraryController {
  constructor(@Inject(ImportPreviews) private readonly previews: ImportPreviews) {}

  /** Unprefixed sources combine both libraries; explicit aliases list only selected content. */
  @Get('sources')
  sources(@StudyContext() context: StudyRequestContext) {
    if (context.url.pathname === '/api/sources') {
      return context.study.sources()
    }
    return this.repository(context).sources()
  }

  /** Preserve first-query-value paging, search and local numeric source IDs. */
  @Get('questions')
  questions(@StudyContext() context: StudyRequestContext) {
    const source = context.query.get('sourceId')
    return this.repository(context).questions(
      source === null ? undefined : positiveInteger(source),
      context.query.get('search') ?? '',
      positiveInteger(context.query.get('page'), 1),
    )
  }

  /** Issue an actor- and visibility-bound ticket from the singleton registry. */
  @Post('imports/preview')
  @HttpCode(200)
  preview(
    @StudyContext() context: StudyRequestContext,
    @JsonObjectBody() input: Record<string, unknown>,
  ) {
    const preview = new ImportService(this.repository(context)).preview(input.bank)
    const token = this.previews.issue(context.actor.id, preview.token, visibility(context))
    return { ...preview, token }
  }

  /** Consume once before the existing importer checks review and content revisions. */
  @Post('imports/confirm')
  @HttpCode(201)
  confirm(
    @StudyContext() context: StudyRequestContext,
    @JsonObjectBody() input: Record<string, unknown>,
  ) {
    if (typeof input.token !== 'string' || typeof input.reviewed !== 'boolean') {
      throw new ApplicationError('Preview token and review confirmation are required.')
    }
    const contentToken = this.previews.consume(context.actor.id, input.token, visibility(context))
    const imported = new ImportService(this.repository(context)).confirm(
      input.bank,
      contentToken,
      input.reviewed,
    )
    return { ...imported, token: input.token }
  }

  /** Retain deletion validation and domain side effects in LibraryService. */
  @Delete(['questions/:id', 'sources/:id'])
  @HttpCode(204)
  deleteItem(@StudyContext() context: StudyRequestContext) {
    const [resource, rawId] = route(context.url.pathname).split('/')
    const id = positiveInteger(rawId!)
    const library = new LibraryService(this.repository(context), visibility(context))
    if (resource === 'questions') {
      library.deleteQuestion(id)
    } else {
      library.deleteSource(id)
    }
  }

  /** Return the selected concept review catalog. */
  @Get('concepts')
  concepts(@StudyContext() context: StudyRequestContext) {
    const service = this.conceptService(context)
    return {
      groups: service.groups(),
      suggestions: service.suggestions(),
      library: service.library(),
    }
  }

  /** Delegate concept DTO validation to its existing service. */
  @Post('concepts')
  @HttpCode(201)
  createConcept(
    @StudyContext() context: StudyRequestContext,
    @JsonObjectBody() input: Record<string, unknown>,
  ) {
    return this.conceptService(context).save(input)
  }

  /** Preserve the permissive raw legacy UUID shape, already checked by the guard. */
  @Put('concepts/:id')
  updateConcept(
    @StudyContext() context: StudyRequestContext,
    @JsonObjectBody() input: Record<string, unknown>,
  ) {
    return this.conceptService(context).save(input, route(context.url.pathname).split('/')[1])
  }

  /** Explicitly serialize JSON null: Nest otherwise treats null as an empty response. */
  @Delete('concepts/:id')
  @HttpCode(200)
  @Header('Content-Type', 'application/json')
  removeConcept(@StudyContext() context: StudyRequestContext) {
    this.conceptService(context).remove(route(context.url.pathname).split('/')[1]!)
    return 'null'
  }

  /** Dismiss only the selected library's exact lowercase digest. */
  @Post('concept-suggestions/:digest/dismiss')
  @HttpCode(200)
  @Header('Content-Type', 'application/json')
  dismiss(@StudyContext() context: StudyRequestContext) {
    this.conceptService(context).dismiss(route(context.url.pathname).split('/')[1]!)
    return 'null'
  }

  /** Borrow the selected repository without retaining or closing its owner. */
  private repository(context: StudyRequestContext) {
    return visibility(context) === 'private' ? context.personal : context.shared
  }

  /** Bind concept operations to the verified actor within the selected library. */
  private conceptService(context: StudyRequestContext) {
    return new ConceptService(context.content(visibility(context)))
  }
}
