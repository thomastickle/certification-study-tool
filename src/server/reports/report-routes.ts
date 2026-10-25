import type { IncomingMessage } from 'node:http'
import type { ReportService } from './report-service.ts'
import type { QuizService } from '../quizzes/quiz-service.ts'
import type { RouteResponse } from '../http-messages.ts'

/** Build scoped reports after settling the account's timed attempts. */
export function reportRoute(
  service: ReportService,
  quizzes: QuizService,
  request: IncomingMessage,
  url: URL,
): RouteResponse | undefined {
  if (request.method !== 'GET' || url.pathname !== '/api/reports') {
    return undefined
  }
  quizzes.expireDue()
  const filters = {
    mode: url.searchParams.get('mode'),
    days: url.searchParams.get('days'),
    provider: url.searchParams.get('provider') ?? undefined,
    certification: url.searchParams.get('certification') ?? undefined,
  }
  return { status: 200, value: service.get(filters) }
}
