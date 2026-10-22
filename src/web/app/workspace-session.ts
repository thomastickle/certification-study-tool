import type { QuizView } from '../../shared/quiz-contracts.ts'
import type { Certification } from '../features/certifications/certifications.ts'
import { api } from '../shared/lib/api.ts'

/**
 * Suspend server-owned work even when a reload left no practice page mounted.
 * @throws {Error} When recovery or a pause fails; callers must retain the current workspace.
 */
export async function pauseCertificationAttempts(certification: Certification): Promise<void> {
  const scope = new URLSearchParams({
    provider: certification.provider,
    certification: certification.code,
  })
  const attempts = await Promise.all(
    ['quiz', 'exam', 'review'].map((mode) =>
      api<QuizView | null>(`/quizzes/current?${scope}&mode=${mode}`),
    ),
  )
  for (const attempt of attempts) {
    if (attempt?.status !== 'active') {
      continue
    }
    const suspended = await api<QuizView>(`/quizzes/${attempt.id}/pause`, {
      method: 'POST',
      body: JSON.stringify({ cause: 'navigation' }),
    })
    if (suspended.status === 'active') {
      throw new Error('The previous attempt is still running. Retry switching certifications.')
    }
  }
}
