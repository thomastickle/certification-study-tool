import { Body } from '@nestjs/common'
import { ReadJsonBody } from '../security/json-body.interceptor.ts'
import { Controller, Delete, HttpCode, Post, Put, Header } from '@nestjs/common'

import {
  StudyContext,
  StudyRequest,
  LibraryWrite,
  OriginalPath,
} from '../security/security-context.ts'
import type { StudyRequestContext } from '../security/security-context.ts'
import { conceptService } from './library-context.ts'
import { route } from './library-route.ts'

/** Share operations without duplicating route or import logic between content namespaces. */
@StudyRequest()
abstract class ConceptOperations {
  /** Delegate concept DTO validation to its existing service. */
  @Post('concepts')
  @ReadJsonBody()
  @OriginalPath(/^\/api\/(?:shared\/|private\/)?concepts$/)
  @HttpCode(201)
  createConcept(
    @StudyContext() context: StudyRequestContext,
    @Body() input: Record<string, unknown>,
  ) {
    return conceptService(context).save(input)
  }

  /** Preserve the permissive raw legacy UUID shape, already checked by the guard. */
  @Put('concepts/:id')
  @ReadJsonBody()
  @OriginalPath(/^\/api\/(?:shared\/|private\/)?concepts\/[a-f0-9-]{36}$/)
  updateConcept(
    @StudyContext() context: StudyRequestContext,
    @Body() input: Record<string, unknown>,
  ) {
    return conceptService(context).save(input, route(context.url.pathname).split('/')[1])
  }

  /** Explicitly serialize JSON null: Nest otherwise treats null as an empty response. */
  @Delete('concepts/:id')
  @OriginalPath(/^\/api\/(?:shared\/|private\/)?concepts\/[a-f0-9-]{36}$/)
  @HttpCode(200)
  @Header('Content-Type', 'application/json')
  removeConcept(@StudyContext() context: StudyRequestContext) {
    conceptService(context).remove(route(context.url.pathname).split('/')[1]!)
    return 'null'
  }

  /** Dismiss only the selected library's exact lowercase digest. */
  @Post('concept-suggestions/:digest/dismiss')
  @OriginalPath(/^\/api\/(?:shared\/|private\/)?concept-suggestions\/[a-f0-9]{64}\/dismiss$/)
  @HttpCode(200)
  @Header('Content-Type', 'application/json')
  dismiss(@StudyContext() context: StudyRequestContext) {
    conceptService(context).dismiss(route(context.url.pathname).split('/')[1]!)
    return 'null'
  }
}

/** Declare shared write policy on the concrete Nest route owner. */
@Controller(['api', 'api/shared'])
@LibraryWrite('shared')
export class SharedConceptController extends ConceptOperations {}

/** Declare private write policy on the concrete Nest route owner. */
@Controller('api/private')
@LibraryWrite('private')
export class PrivateConceptController extends ConceptOperations {}
