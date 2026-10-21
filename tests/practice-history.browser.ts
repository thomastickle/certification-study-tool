import type { QuizView } from '../src/shared/quiz-contracts.ts'
import { openPracticePreset } from './practice-browser-helpers.ts'

/** Verify unified practice history and setup using real attempts in a disposable database. */
export async function practiceHistoryTest() {
  /** Fail at the observed UI boundary. */
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  /** Wait for the rendered state, with a bounded failure. */
  async function until(predicate: () => boolean, message: string) {
    const deadline = Date.now() + 6000
    while (!predicate()) {
      assert(Date.now() < deadline, message)
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
  }

  /** Create or submit a synthetic attempt through the public API. */
  async function request(path: string, body: unknown): Promise<QuizView> {
    const response = await fetch(`/api${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    assert(response.ok, `Fixture request failed: ${path}`)
    return response.json()
  }

  const ids: string[] = []
  try {
    for (const mode of ['quiz', 'exam']) {
      const attempt = await request('/quizzes', {
        mode,
        provider: 'AWS',
        certification: 'CLF-C02',
        sourceFilter: 'mixed',
        questionType: 'mixed',
      })
      ids.push(attempt.id)
      await request(`/quizzes/${attempt.id}/submit`, { answers: attempt.questions })
    }
    await openPracticePreset('quiz')
    await until(
      () => ids.every((id) => document.querySelector(`[data-result-id="${id}"]`)),
      'Completed must include both quizzes and exams under the quiz preset',
    )
    assert(
      document.querySelector('.completed-results h2')?.textContent === 'Completed',
      'History title must be Completed',
    )
    const setup = document.querySelector('.practice-presets')?.closest('section')
    assert(
      setup?.querySelector('h2')?.textContent === 'Set up your quiz',
      'Session presets must be inside Set up your quiz',
    )
    assert(
      !document.querySelector('.page-heading')?.textContent?.includes('questions'),
      'Header repeats preset question count',
    )
    for (const [index, label] of ['Quiz', 'Exam'].entries()) {
      assert(
        document.querySelector(`[data-result-id="${ids[index]}"] .completed-result-mode`)
          ?.textContent === label,
        `Missing ${label} marker`,
      )
    }
    await openPracticePreset('exam')
    await until(
      () => ids.every((id) => document.querySelector(`[data-result-id="${id}"]`)),
      'Changing presets must retain both kinds of completed attempts',
    )
    document.querySelector<HTMLAnchorElement>(`[data-result-id="${ids[0]}"] a`)!.click()
    await until(
      () => !!document.querySelector('.result-score'),
      'Quiz result did not open from exam preset',
    )
    assert(
      document.querySelector('main h1')?.textContent === 'Quiz results',
      'Result heading uses the preset instead of the saved attempt',
    )
    const back = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.textContent === 'Back to practice history',
    )
    assert(back, 'Result must return to shared practice history')
    back.click()
    await until(() => !!document.querySelector('.completed-results a'), 'History did not return')
    assert(
      document.querySelector('[name="practice-preset"][value="exam"]:checked'),
      'Opening a result changed the setup preset',
    )
    return 'Unified completed history, type markers, embedded presets, compact heading and cross-preset result navigation passed'
  } finally {
    for (const id of ids) {
      await fetch(`/api/quizzes/${id}`, { method: 'DELETE' })
    }
  }
}
