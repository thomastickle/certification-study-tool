/**
 * Browser-only regression: run against a disposable database with enough questions.
 * Transpile with TypeScript's ESNext module target, evaluate in the app's page,
 * then call this for each mode and outcome. This is separate from `npm test`.
 */
export async function delayedStartNavigationTest(
  mode: 'quiz' | 'exam',
  outcome: 'leave' | 'cancel' | 'failure',
): Promise<string> {
  const title = mode === 'exam' ? 'Exam' : 'Quiz'
  const originalFetch = window.fetch
  const originalConfirm = window.confirm
  let release!: () => void
  const delayed = new Promise<void>((resolve) => {
    release = resolve
  })
  let started = false
  let attemptId: string | undefined
  let confirmations = 0

  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message)
  }

  async function until(predicate: () => boolean, message: string) {
    const deadline = Date.now() + 5000
    while (!predicate()) {
      assert(Date.now() < deadline, message)
      await new Promise((resolve) => window.setTimeout(resolve, 10))
    }
  }

  function click(label: string) {
    const button = [...document.querySelectorAll('button')].find(
      (item) => item.textContent?.trim() === label,
    )
    assert(button && !button.disabled, `Missing enabled button: ${label}`)
    button.click()
  }

  window.confirm = () => {
    confirmations++
    return outcome !== 'cancel'
  }
  window.fetch = async (input, init) => {
    if (input === '/api/quizzes' && init?.method === 'POST') {
      started = true
      if (outcome === 'failure') {
        await delayed
        return new Response(JSON.stringify({ error: 'Synthetic start failure' }), { status: 422 })
      }
      const response = await originalFetch(input, init)
      attemptId = (await response.clone().json()).id
      await delayed
      return response
    }
    return originalFetch(input, init)
  }
  try {
    click(title)
    const startLabel = `Start ${mode === 'exam' ? 65 : 20}-question ${mode}`
    await until(
      () =>
        [...document.querySelectorAll('button')].some(
          (button) => button.textContent?.trim() === startLabel && !button.disabled,
        ),
      'Setup did not load',
    )
    click(startLabel)
    await until(() => started, 'Start request was not sent')
    click('Reports')
    // Let React process navigation while the response is deliberately held.
    await new Promise((resolve) => window.setTimeout(resolve, 50))
    assert(
      document.querySelector('h1')?.textContent === title,
      'Navigation orphaned the pending attempt',
    )
    release()
    if (outcome === 'cancel') {
      await until(() => confirmations === 1, 'Leave confirmation was not shown')
      assert(
        document.querySelector('h1')?.textContent === title,
        'Canceled navigation left the attempt',
      )
      window.confirm = () => true
      click('Reports')
    }
    await until(
      () => document.querySelector('h1')?.textContent === 'Reports',
      'Navigation did not finish',
    )
    assert(confirmations === (outcome === 'failure' ? 0 : 1), 'Unexpected confirmation count')
    if (attemptId) {
      const attempt = await (await originalFetch(`/api/quizzes/${attemptId}`)).json()
      assert(attempt.status === 'abandoned', 'Leaving did not abandon the created attempt')
    }
    return `${mode}: delayed start ${outcome} passed`
  } finally {
    release()
    window.fetch = originalFetch
    window.confirm = originalConfirm
  }
}
