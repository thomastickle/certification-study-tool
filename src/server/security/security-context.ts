import type { StudyInputWork } from './study-input-work.ts'
import type { IncomingMessage } from 'node:http'
import { createParamDecorator, SetMetadata } from '@nestjs/common'
import type { ExecutionContext } from '@nestjs/common'
import type { SessionUser } from '../../shared/auth-contracts.ts'
import type { RequestUrl } from '../http/request-url.ts'
import type { LibraryView } from '../questions/library-repository.ts'
import type { StudyLibrary } from '../questions/study-library.ts'
import type { LibraryRepository } from '../questions/library-repository.ts'

export const PUBLIC_METHOD = Symbol('PublicMethod')

export const STUDY_REQUEST = Symbol('StudyRequest')

export const ORIGINAL_PATH = Symbol('OriginalPath')

/** Constrain the admitted raw target before content authorization or any scoped input work. */
export const OriginalPath = (pattern: RegExp) => SetMetadata(ORIGINAL_PATH, pattern)

export const LIBRARY_WRITE = Symbol('LibraryWrite')

export type LibraryVisibility = 'shared' | 'private'

export type StudyRequestContext = {
  inputSignal: AbortSignal
  actor: SessionUser
  url: RequestUrl
  query: URLSearchParams
  personal: LibraryRepository
  shared: LibraryRepository
  study: StudyLibrary
  content: (visibility: LibraryVisibility) => LibraryView
}

export type AdmittedRequest = IncomingMessage & {
  admission: { url: RequestUrl; user: SessionUser | undefined }
  studyContext?: StudyRequestContext
  inputWork?: StudyInputWork
  securityWorkOwned?: boolean
  studyErrors?: boolean
  finishSecurityWork?: () => void
}

/** Public access is tied to the supported method, never inherited by implicit HEAD. */
export const PublicMethod = (method: 'GET' | 'POST') => SetMetadata(PUBLIC_METHOD, method)

/** Acquire the actor's personal connection before any parameter/body resolution. */
export const StudyRequest = () => SetMetadata(STUDY_REQUEST, true)

/** Mark shared-content writes explicitly; private writes remain available to their verified owner. */
export const LibraryWrite = (visibility: LibraryVisibility) =>
  SetMetadata(LIBRARY_WRITE, visibility)

/** Read the immutable admitted target rather than Express's mutable URL/query parser. */
export const NormalizedUrl = createParamDecorator(
  (_data: unknown, context: ExecutionContext) =>
    context.switchToHttp().getRequest<AdmittedRequest>().admission.url,
)

/** Return a consumer-owned parser with the baseline first-value-wins semantics. */
export const NormalizedQuery = createParamDecorator(
  (_data: unknown, context: ExecutionContext) =>
    new URLSearchParams(context.switchToHttp().getRequest<AdmittedRequest>().admission.url.search),
)

/** Supply the session verified by the guard; input headers cannot substitute an actor. */
export const VerifiedActor = createParamDecorator(
  (_data: unknown, context: ExecutionContext) =>
    context.switchToHttp().getRequest<AdmittedRequest>().admission.user,
)

/** Borrow service-ready repositories only for the awaited controller operation. */
export const StudyContext = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  const value = context.switchToHttp().getRequest<AdmittedRequest>().studyContext
  if (!value) {
    throw new Error('StudyContext requires @StudyRequest().')
  }
  return value
})
