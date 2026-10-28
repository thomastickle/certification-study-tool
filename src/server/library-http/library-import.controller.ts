import { Body } from '@nestjs/common'
import { ReadJsonBody } from '../security/json-body.interceptor.ts'
import { Controller, HttpCode, Inject, Post } from '@nestjs/common'
import { ApplicationError } from '../http/errors.ts'
import { ImportService } from '../importer/import-service.ts'
import { ImportPreviews } from '../importer/import-previews.ts'

import {
  StudyContext,
  StudyRequest,
  LibraryWrite,
  OriginalPath,
} from '../security/security-context.ts'
import type { StudyRequestContext } from '../security/security-context.ts'
import { visibility, repository } from './library-context.ts'

/** Share operations without duplicating route or import logic between content namespaces. */
@StudyRequest()
abstract class LibraryImportOperations {
  constructor(@Inject(ImportPreviews) private readonly previews: ImportPreviews) {}

  /** Issue an actor- and visibility-bound ticket from the singleton registry. */
  @Post('imports/preview')
  @ReadJsonBody()
  @OriginalPath(/^\/api\/(?:shared\/|private\/)?imports\/preview$/)
  @HttpCode(200)
  preview(@StudyContext() context: StudyRequestContext, @Body() input: Record<string, unknown>) {
    const preview = new ImportService(repository(context)).preview(input.bank)
    const token = this.previews.issue(context.actor.id, preview.token, visibility(context))
    return { ...preview, token }
  }

  /** Consume once before the existing importer checks review and content revisions. */
  @Post('imports/confirm')
  @ReadJsonBody()
  @OriginalPath(/^\/api\/(?:shared\/|private\/)?imports\/confirm$/)
  @HttpCode(201)
  confirm(@StudyContext() context: StudyRequestContext, @Body() input: Record<string, unknown>) {
    if (typeof input.token !== 'string' || typeof input.reviewed !== 'boolean') {
      throw new ApplicationError('Preview token and review confirmation are required.')
    }
    const contentToken = this.previews.consume(context.actor.id, input.token, visibility(context))
    const imported = new ImportService(repository(context)).confirm(
      input.bank,
      contentToken,
      input.reviewed,
    )
    return { ...imported, token: input.token }
  }
}

/** Declare shared write policy on the concrete Nest route owner. */
@Controller(['api', 'api/shared'])
@LibraryWrite('shared')
export class SharedLibraryImportController extends LibraryImportOperations {}

/** Declare private write policy on the concrete Nest route owner. */
@Controller('api/private')
@LibraryWrite('private')
export class PrivateLibraryImportController extends LibraryImportOperations {}
