import { openPracticePreset } from './practice-browser-helpers.ts'

/** Run in a disposable populated app after transpiling with TypeScript (ESNext). */
export async function lostResumeCheck(
  mode: 'quiz' | 'exam',
  outcome: 'leave' | 'read-failure' | 'pause-failure' | 'poll-recovery' | 'stale-poll',
) {
  const title = mode === 'exam' ? 'Exam' : 'Quiz'
  const originalFetch = window.fetch
  const originalConfirm = window.confirm
  let attemptId = ''
  let resumed = false
  let failRead = outcome === 'read-failure' || outcome === 'poll-recovery'
  let failPause = outcome === 'pause-failure'
  let stalePollHeld = false

  let releasePoll = () => {}

  const delayedPoll = new Promise<void>((resolve) => {
    releasePoll = resolve
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

  async function attempt() {
    return (await originalFetch(`/api/quizzes/${attemptId}`)).json()
  }

  window.confirm = () => true
  window.fetch = async (input, init) => {
    const url = String(input)
    if (url.endsWith('/resume') && !resumed) {
      await originalFetch(input, init)
      resumed = true
      throw new TypeError('Synthetic lost resume response')
    }
    if (url === `/api/quizzes/${attemptId}` && !init?.method) {
      if (resumed && failRead) {
        throw new TypeError('Synthetic status read failure')
      }
      if (outcome === 'stale-poll' && !resumed && !stalePollHeld) {
        const response = await originalFetch(input, init)
        stalePollHeld = true
        await delayedPoll
        return response
      }
    }
    if (resumed && url.endsWith('/pause') && failPause) {
      // The server accepts the navigation pause, but the client cannot confirm it.
      await originalFetch(input, init)
      throw new TypeError('Synthetic lost navigation pause response')
    }
    return originalFetch(input, init)
  }
  try {
    click('Reports')
    await until(() => !!document.querySelector('.reports-page'), 'Previous screen did not close')
    await openPracticePreset(mode)
    const startLabel = `Start ${mode === 'quiz' ? 20 : 65}-question ${mode}`
    await until(
      () =>
        [...document.querySelectorAll('button')].some(
          (button) => button.textContent?.trim() === startLabel && !button.disabled,
        ),
      'Setup did not load',
    )
    click(startLabel)
    await until(() => !!document.querySelector('.quiz-question'), 'Question did not load')
    const current = await (await originalFetch(`/api/quizzes/current?mode=${mode}`)).json()
    attemptId = current.id
    await until(
      () => document.querySelector<HTMLInputElement>('.answer-choices input')?.disabled === false,
      'Answer controls did not become ready',
    )
    document.querySelector<HTMLInputElement>('.answer-choices input')!.click()
    await new Promise((resolve) => window.setTimeout(resolve, 0))
    await until(
      () => document.querySelector('.answer-save-status')?.textContent === 'Saved',
      'Answer did not save',
    )
    document.querySelector<HTMLInputElement>('.flag-control input')!.click()
    await new Promise((resolve) => window.setTimeout(resolve, 0))
    await until(
      () => document.querySelector('.answer-save-status')?.textContent === 'Saved',
      'Review mark did not save',
    )
    click('Pause')
    await until(() => !!document.querySelector('.paused-panel'), 'Manual pause failed')
    if (outcome === 'stale-poll') {
      await until(() => stalePollHeld, 'Paused poll was not held')
    }
    click(`Resume ${mode}`)
    await until(
      () => document.body.innerText.includes('Synthetic lost resume response'),
      'Lost resume error missing',
    )
    assert((await attempt()).status === 'active', 'Resume did not reach the server')
    if (outcome === 'read-failure' || outcome === 'poll-recovery') {
      await until(
        () => document.body.innerText.includes('timer may still be running'),
        'Unknown resume outcome falsely claims a stopped timer',
      )
      assert(!document.querySelector('.paused-panel'), 'Unconfirmed attempt still claims paused')
      const unload = new Event('beforeunload', { cancelable: true })
      window.dispatchEvent(unload)
      assert(unload.defaultPrevented, 'Unconfirmed resume lost the unload warning')
      click('Reports')
      await until(
        () => document.body.innerText.includes('Retry navigation to suspend it safely'),
        'Failed reconciliation was not explained',
      )
      assert(!document.querySelector('.reports-page'), 'Failed reconciliation allowed navigation')
      failRead = false
      if (outcome === 'poll-recovery') {
        await until(() => !!document.querySelector('.quiz-question'), 'Polling did not recover')
        assert(
          !document.querySelector('.paused-panel'),
          'Recovered active timer still looks paused',
        )
      }
    }
    if (outcome === 'stale-poll') {
      await until(() => !!document.querySelector('.quiz-question'), 'Resume did not reconcile')
      releasePoll()
      await new Promise((resolve) => window.setTimeout(resolve, 100))
      assert(!!document.querySelector('.quiz-question'), 'Stale paused poll undid the resume')
    }
    click('Reports')
    if (outcome === 'pause-failure') {
      await until(
        () => document.body.innerText.includes('Synthetic lost navigation pause response'),
        'Failed pause was not explained',
      )
      assert(!document.querySelector('.reports-page'), 'Unconfirmed pause allowed navigation')
      failPause = false
      click('Reports')
    }
    await until(() => !!document.querySelector('.reports-page'), 'Navigation did not finish')
    const paused = await attempt()
    assert(paused.status === 'paused', 'Lost resume left a running attempt behind')
    assert(paused.pauseHistory.intervals.length === 2, 'Retry duplicated pause intervals')
    assert(paused.pauseHistory.intervals[0].endedAt !== null, 'First pause was not closed')
    assert(paused.pauseHistory.intervals[1].cause === 'navigation', 'Suspension cause missing')
    assert(paused.pauseHistory.intervals[1].endedAt === null, 'Suspension was already closed')
    assert(paused.questions[0].selected.length === 1, 'Saved answer was lost')
    assert(paused.questions[0].flagged, 'Saved review mark was lost')
    await new Promise((resolve) => window.setTimeout(resolve, 100))
    const frozen = await attempt()
    assert(frozen.deadline === paused.deadline, 'Paused deadline moved')
    assert(frozen.pausedAt === paused.pausedAt, 'Paused remaining time changed')
    const report = await (await originalFetch('/api/reports')).json()
    assert(
      !report.attempts.some((item: { id: string }) => item.id === attemptId),
      'Unfinished attempt entered reports',
    )
    await openPracticePreset(mode)
    await until(() => document.body.innerText.includes(`Continue ${mode}`), 'Recovery missing')
    click(`Continue ${mode}`)
    await until(() => !!document.querySelector('.paused-panel'), 'Recovery resumed implicitly')
    click(`Resume ${mode}`)
    await until(() => !!document.querySelector('.quiz-question'), 'Explicit resume failed')
    await until(
      () =>
        [...document.querySelectorAll('button')].some(
          (button) => button.textContent?.trim() === 'Submit and score' && !button.disabled,
        ),
      'Resumed actions did not become ready',
    )
    document.querySelector<HTMLElement>('.practice-menu summary')!.click()
    click('Submit and score')
    await until(
      () => document.querySelector('h1')?.textContent === `${title} results`,
      'Submission failed',
    )
    const completed = await attempt()
    const repeated = await (
      await originalFetch(`/api/quizzes/${attemptId}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers: [] }),
      })
    ).json()
    assert(repeated.finishedAt === completed.finishedAt, 'Retry graded the attempt again')
    assert(completed.pauseHistory.intervals.length === 2, 'Completion duplicated intervals')
    assert(
      completed.pauseHistory.intervals.every((p: { endedAt: number | null }) => p.endedAt !== null),
      'Completion left an ongoing pause',
    )
    const finalReport = await (await originalFetch('/api/reports')).json()
    assert(
      finalReport.attempts.filter((item: { id: string }) => item.id === attemptId).length === 1,
      'Completed attempt was not reported exactly once',
    )
    return `${mode}: lost resume / ${outcome} passed`
  } finally {
    releasePoll()
    window.fetch = originalFetch
    window.confirm = originalConfirm
    if (attemptId) {
      await originalFetch(`/api/quizzes/${attemptId}/abandon`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
    }
  }
}
