import type { StudyRequestContext } from '../security/security-context.ts'

/** Extract only after the route guard has verified the original normalized shape. */
export function quizId(ctx: StudyRequestContext): string {
  return ctx.url.pathname.split('/')[3]!
}

/** Preserve first-value query semantics for certification-scoped reads. */
export function scope(ctx: StudyRequestContext) {
  return {
    provider: ctx.query.get('provider') ?? undefined,
    certification: ctx.query.get('certification') ?? undefined,
  }
}
