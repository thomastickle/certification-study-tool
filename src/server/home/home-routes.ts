import type { IncomingMessage } from 'node:http'
import type { HomeService } from './home-service.ts'
import type { QuizService } from '../quizzes/quiz-service.ts'
import { readJsonBody } from '../http-messages.ts'
import type { RouteResponse } from '../http-messages.ts'

/** Settle timed work before returning the overview or changing an earned certification. */
export async function homeRoute(
  service: HomeService,
  quizzes: QuizService,
  request: IncomingMessage,
  url: URL,
): Promise<RouteResponse | undefined> {
  if (request.method === 'GET' && url.pathname === '/api/home') {
    quizzes.expireDue()
    return { status: 200, value: service.get() }
  }
  if (request.method === 'PUT' && url.pathname === '/api/certifications/earned') {
    quizzes.expireDue()
    const input = await readJsonBody(request)
    return { status: 200, value: service.setEarned(input) }
  }
  return undefined
}
