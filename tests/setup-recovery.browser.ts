import { openPracticePreset } from './practice-browser-helpers.ts'

import type { QuizView } from '../src/shared/quiz-contracts.ts'

/** Exercise setup recovery against a disposable populated app and its real persistence API. */
export async function setupRecoveryCheck(
  mode: 'quiz' | 'exam',
  outcome:
    | 'loaded'
    | 'pending'
    | 'read-failure'
    | 'pending-failure'
    | 'continue-failure'
    | 'history-pending'
    | 'history-return'
    | 'history-return-no-current'
    | 'history-return-read-failure'
    | 'completed'
    | 'retry-button'
    | 'paused'
    | 'no-current',
) {
  const originalFetch = window.fetch
  let attemptId = ''
  let readStarted = false
  const historyReturn = outcome.startsWith('history-return')
  const noCurrent = outcome === 'no-current' || outcome === 'history-return-no-current'
  let recoveryReads = 0
  let failRead = [
    'read-failure',
    'pending-failure',
    'retry-button',
    'history-return-read-failure',
  ].includes(outcome)
  let failContinue = outcome === 'continue-failure'

  let release = () => {}

  const delayed = new Promise<void>((resolve) => {
    release = resolve
  })

  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  async function until(predicate: () => boolean, message: string) {
    const deadline = Date.now() + 8000
    while (!predicate()) {
      assert(Date.now() < deadline, `${message}: ${document.body.innerText.slice(-700)}`)
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
  }

  function click(label: string) {
    const button = [...document.querySelectorAll('button')].find(
      (item) => item.textContent?.trim() === label,
    )
    assert(button && !button.disabled, `Missing enabled button: ${label}`)
    button.click()
  }

  /** Use the unmodified transport to inspect real server state and prepare synthetic work. */
  async function request(path: string, body?: unknown, method = 'POST') {
    const response = await originalFetch(`/api${path}`, {
      ...(body === undefined ? {} : { method, body: JSON.stringify(body) }),
      headers: { 'Content-Type': 'application/json' },
    })
    assert(response.ok, `Fixture request failed: ${path} (${response.status})`)
    return response.json()
  }

  try {
    click('Reports')
    await until(() => !!document.querySelector('.reports-page'), 'Previous screen did not close')
    const previous = await request(`/quizzes/current?mode=${mode}`)
    assert(!previous, 'Use a disposable database without unfinished attempts')
    if (outcome === 'history-pending' || historyReturn) {
      const history: QuizView = await request('/quizzes', {
        mode,
        sourceFilter: 'mixed',
        questionType: 'mixed',
      })
      await request(`/quizzes/${history.id}/submit`, { answers: history.questions })
    }
    if (!noCurrent) {
      const created: QuizView = await request('/quizzes', {
        mode,
        sourceFilter: 'mixed',
        questionType: 'mixed',
      })
      attemptId = created.id
      const question = created.questions[0]!
      await request(
        `/quizzes/${attemptId}/answers`,
        {
          answers: created.questions.map((item) => ({
            questionId: item.questionId,
            selected: item === question ? [question.answers[0]!.id] : [],
            confidence: item === question ? 'Unsure' : null,
            flagged: item === question,
          })),
        },
        'PUT',
      )
      if (outcome === 'paused') {
        await request(`/quizzes/${attemptId}/pause`, { cause: 'manual' })
      }
    }
    const { generatedAt: _baselineTime, ...baselineReport } = await request('/reports')
    const originalAttempt: QuizView | null = attemptId
      ? await request(`/quizzes/${attemptId}`)
      : null
    window.fetch = async (input, init) => {
      const url = String(input)
      if (url === `/api/quizzes/current?mode=${mode}`) {
        readStarted = true
        recoveryReads++
        if (['pending', 'pending-failure', 'history-pending'].includes(outcome) || historyReturn) {
          await delayed
        }
        if (failRead && (!historyReturn || recoveryReads > 1)) {
          throw new TypeError('Synthetic setup recovery failure')
        }
      }
      if (url === `/api/quizzes/${attemptId}` && !init?.method && failContinue) {
        readStarted = true
        await delayed
        throw new TypeError('Synthetic Continue recovery failure')
      }
      return originalFetch(input, init)
    }
    await openPracticePreset(mode)
    await until(() => readStarted, 'Setup recovery did not begin')
    if (['loaded', 'paused', 'continue-failure', 'completed'].includes(outcome)) {
      await until(() => !!document.querySelector('.recovery-panel'), 'Recovery panel missing')
    }
    if (outcome === 'history-pending' || historyReturn) {
      await until(
        () => document.body.innerText.includes('Review results'),
        'Completed history did not load',
      )
      click('Review results')
      await until(() => !!document.querySelector('.result-score'), 'Completed result did not load')
    }
    if (historyReturn) {
      click(`Back to ${mode} history`)
      await until(() => !document.querySelector('.result-score'), 'History did not reopen')
      release()
      if (failRead) {
        await until(
          () => document.body.innerText.includes('Synthetic setup recovery failure'),
          'Fresh recovery failure was not surfaced after returning to history',
        )
      } else if (noCurrent) {
        await until(
          () =>
            [...document.querySelectorAll('button')].some(
              (button) =>
                button.textContent?.trim() ===
                  `Start ${mode === 'quiz' ? 20 : 65}-question ${mode}` && !button.disabled,
            ),
          'No-current setup did not become ready after returning to history',
        )
        click(`Start ${mode === 'quiz' ? 20 : 65}-question ${mode}`)
        await until(
          () => !!document.querySelector('.quiz-question'),
          'Start was enabled but did not start after returning to history',
        )
        const started: QuizView = await request(`/quizzes/current?mode=${mode}`)
        attemptId = started.id
        click('Reports')
        await until(() => !!document.querySelector('.reports-page'), 'New attempt did not suspend')
        assert(
          (await request(`/quizzes/${attemptId}`)).status === 'paused',
          'New attempt was left running',
        )
        return `${mode}: ${outcome} passed`
      } else {
        await until(
          () =>
            [...document.querySelectorAll('button')].some(
              (button) => button.textContent?.trim() === `Continue ${mode}` && !button.disabled,
            ),
          'Continue did not recover after returning to history',
        )
      }
    }
    if (outcome === 'completed') {
      await request(`/quizzes/${attemptId}/submit`, { answers: originalAttempt!.questions })
    }
    if (outcome === 'read-failure' || outcome === 'retry-button') {
      await until(
        () => document.body.innerText.includes('Synthetic setup recovery failure'),
        'Recovery failure missing',
      )
    }
    if (outcome === 'retry-button') {
      failRead = false
      click('Retry recovery')
      await until(() => !!document.querySelector('.recovery-panel'), 'Recovery retry failed')
    }
    if (outcome === 'continue-failure') {
      readStarted = false
      click(`Continue ${mode}`)
      await until(() => readStarted, 'Continue recovery did not begin')
    }
    click('Reports')
    if (['pending', 'pending-failure', 'continue-failure', 'history-pending'].includes(outcome)) {
      await new Promise((resolve) => setTimeout(resolve, 75))
      assert(
        document.querySelector('[aria-current=page]')?.textContent === 'Practice',
        'Navigation did not await recovery',
      )
      release()
    }
    if (failRead || failContinue) {
      await until(() => !!document.querySelector('[role=alert]'), 'Recovery error missing')
      await new Promise((resolve) => setTimeout(resolve, 75))
      assert(
        document.querySelector('[aria-current=page]')?.textContent === 'Practice',
        'Failed recovery allowed navigation',
      )
      assert(
        document.body.innerText.toLowerCase().includes('retry'),
        'Recovery error does not explain retry',
      )
      assert((await request(`/quizzes/${attemptId}`)).status === 'active', 'Failure changed work')
      failRead = false
      failContinue = false
      click('Reports')
    }
    await until(() => !!document.querySelector('.reports-page'), 'Navigation did not finish')
    if (!originalAttempt) {
      assert((await request(`/quizzes/current?mode=${mode}`)) === null, 'Navigation created work')
      return `${mode}: ${outcome} passed`
    }
    if (outcome === 'completed') {
      const completed: QuizView = await request(`/quizzes/${attemptId}`)
      assert(completed.status === 'completed', 'Recovery changed completed state')
      assert(completed.pauseHistory?.intervals.length === 0, 'Recovery paused completed work')
      const report = await request('/reports')
      assert(
        report.attempts.filter((item: { id: string }) => item.id === attemptId).length === 1,
        'Completed recovery was not reported once',
      )
      return `${mode}: ${outcome} passed`
    }
    const paused: QuizView = await request(`/quizzes/${attemptId}`)
    assert(paused.id === originalAttempt.id, 'Recovery changed identity')
    assert(paused.status === 'paused', 'Setup navigation did not suspend active work')
    assert(
      JSON.stringify(paused.questions) === JSON.stringify(originalAttempt.questions),
      'Recovery changed answers, confidence, or flags',
    )
    assert(paused.pauseHistory?.intervals.length === 1, 'Recovery duplicated or lost pause history')
    assert(
      paused.pauseHistory.intervals[0]?.cause === (outcome === 'paused' ? 'manual' : 'navigation'),
      'Recovery changed pause cause',
    )
    const frozen = paused.deadline - paused.pausedAt!
    await new Promise((resolve) => setTimeout(resolve, 100))
    const observed: QuizView = await request(`/quizzes/${attemptId}`)
    assert(observed.deadline - observed.pausedAt! === frozen, 'Paused remaining time changed')
    const { generatedAt: _observedTime, ...unfinishedReport } = await request('/reports')
    assert(
      JSON.stringify(unfinishedReport) === JSON.stringify(baselineReport),
      'Unfinished attempt changed report totals or breakdowns',
    )
    await openPracticePreset(mode)
    await until(() => !!document.querySelector('.recovery-panel'), 'Return recovery missing')
    click(`Continue ${mode}`)
    await until(() => !!document.querySelector('.paused-panel'), 'Continue resumed implicitly')
    assert((await request(`/quizzes/${attemptId}`)).status === 'paused', 'Continue started timer')
    click(`Resume ${mode}`)
    await until(() => !!document.querySelector('.quiz-question'), 'Explicit resume failed')
    const resumed: QuizView = await request(`/quizzes/${attemptId}`)
    assert(resumed.id === attemptId && resumed.status === 'active', 'Resume replaced attempt')
    assert(resumed.deadline - resumed.serverNow <= frozen, 'Resume added active time')
    const completed: QuizView = await request(`/quizzes/${attemptId}/submit`, {
      answers: resumed.questions,
    })
    await request(`/quizzes/${attemptId}/submit`, { answers: resumed.questions })
    assert(completed.status === 'completed', 'Submission did not complete')
    const finalReport = await request('/reports')
    assert(
      finalReport.attempts.filter((item: { id: string }) => item.id === attemptId).length === 1,
      'Completed recovery did not contribute exactly once',
    )
    click('Reports')
    await until(() => !!document.querySelector('.reports-page'), 'Completed screen did not close')
    return `${mode}: ${outcome} passed`
  } finally {
    release()
    window.fetch = originalFetch
    if (attemptId) {
      await request(`/quizzes/${attemptId}/abandon`, {})
    }
  }
}
