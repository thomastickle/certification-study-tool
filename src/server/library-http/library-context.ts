import { ApplicationError } from '../http/errors.ts'
import { ConceptService } from '../concepts/concept-service.ts'
import type { StudyRequestContext } from '../security/security-context.ts'

/** Preserve digits-first route matching followed by positive safe-integer validation. */
export function positiveInteger(value: string | null, fallback?: number): number {
  if (value === null && fallback !== undefined) {
    return fallback
  }
  if (!value || !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) {
    throw new ApplicationError('Expected a positive integer.')
  }
  return Number(value)
}

/** Select content from the admitted namespace, never from client-supplied account IDs. */
export function visibility(context: StudyRequestContext): 'private' | 'shared' {
  return context.url.pathname.startsWith('/api/private/') ? 'private' : 'shared'
}

/** Select only from the verified request's existing repositories. */
export function repository(context: StudyRequestContext) {
  return visibility(context) === 'private' ? context.personal : context.shared
}

/** Compose concept behavior inside the verified actor's selected content view. */
export function conceptService(context: StudyRequestContext) {
  return new ConceptService(context.content(visibility(context)))
}
