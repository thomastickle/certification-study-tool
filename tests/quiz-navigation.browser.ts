import { workspaceFetch } from './browser-api.ts'

import { openPracticeActions, openPracticePreset } from './practice-browser-helpers.ts'

/** Run in a disposable populated app after transpiling with TypeScript (ESNext). */
export async function navigationCheck(
  mode: 'quiz' | 'exam',
  outcome:
    | 'leave'
    | 'lost-start'
    | 'recovery-failure'
    | 'failure'
    | 'save-failure'
    | 'pause-failure'
    | 'pending-save'
    | 'pending-save-failure'
    | 'pending-pause-failure'
    | 'lost-pause'
    | 'manual-race'
    | 'resume-race'
    | 'submit-race',
) {
  const title = mode === 'exam' ? 'Exam' : 'Quiz'
  const originalFetch = window.fetch
  const originalConfirm = window.confirm
  let release!: () => void
  const delayed = new Promise<void>((resolve) => {
    release = resolve
  })
  let started = false
  let mutationStarted = false
  let attemptId = ''
  let fail = true
  let confirmations = 0

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
    return (await workspaceFetch(`/api/quizzes/${attemptId}`, {}, originalFetch)).json()
  }

  window.confirm = () => {
    confirmations++
    return true
  }
  window.fetch = async (input, init) => {
    const url = String(input)
    if (url === '/api/quizzes' && init?.method === 'POST') {
      started = true
      if (outcome === 'failure' && fail) {
        await delayed
        return new Response(JSON.stringify({ error: 'Synthetic start failure' }), { status: 422 })
      }
      const response = await originalFetch(input, init)
      attemptId = (await response.clone().json()).id
      if (['lost-start', 'recovery-failure'].includes(outcome) && fail) {
        await delayed
        return new Response(JSON.stringify({ error: 'Synthetic lost start response' }), {
          status: 500,
        })
      }
      if (outcome === 'leave') {
        await delayed
      }
      return response
    }
    if (started && outcome === 'recovery-failure' && fail && url.includes('/quizzes/current')) {
      return new Response(JSON.stringify({ error: 'Synthetic recovery failure' }), { status: 500 })
    }
    if (url.endsWith('/answers') && init?.method === 'PUT') {
      if (outcome === 'save-failure' && fail) {
        return new Response(JSON.stringify({ error: 'Synthetic answer failure' }), { status: 500 })
      }
      if (outcome === 'pending-save-failure' && fail) {
        mutationStarted = true
        await delayed
        return new Response(JSON.stringify({ error: 'Synthetic answer failure' }), { status: 500 })
      }
      const response = await originalFetch(input, init)
      if (outcome === 'pending-save' && !mutationStarted) {
        mutationStarted = true
        await delayed
      }
      return response
    }
    if (url.endsWith('/pause') && fail) {
      if (outcome === 'pending-pause-failure' && !mutationStarted) {
        mutationStarted = true
        await delayed
        return new Response(JSON.stringify({ error: 'Synthetic pause failure' }), { status: 500 })
      }
      if (outcome === 'pause-failure' || outcome === 'lost-pause') {
        if (outcome === 'lost-pause') {
          await originalFetch(input, init)
        }
        return new Response(JSON.stringify({ error: 'Synthetic pause failure' }), { status: 500 })
      }
      if (outcome === 'manual-race') {
        const response = await originalFetch(input, init)
        mutationStarted = true
        await delayed
        return response
      }
    }
    if (
      (url.endsWith('/resume') && outcome === 'resume-race') ||
      (url.endsWith('/submit') && outcome === 'submit-race')
    ) {
      const response = await originalFetch(input, init)
      mutationStarted = true
      await delayed
      return response
    }
    return originalFetch(input, init)
  }
  try {
    click('Reports')
    await until(() => !!document.querySelector('.reports-page'), 'Could not leave previous screen')
    await openPracticePreset(mode)
    const startLabel = `Start ${mode === 'exam' ? 65 : 20}-question ${mode}`
    await until(
      () =>
        [...document.querySelectorAll('button')].some(
          (b) => b.textContent?.trim() === startLabel && !b.disabled,
        ),
      'Setup did not load',
    )
    click(startLabel)
    await until(() => started, 'Start request was not sent')
    if (['leave', 'failure', 'lost-start', 'recovery-failure'].includes(outcome)) {
      click('Reports')
      click('Library')
      await new Promise((resolve) => window.setTimeout(resolve, 50))
      assert(
        document.querySelector('[aria-current=page]')?.textContent === 'Practice',
        'Navigation orphaned pending start',
      )
      release()
      if (['lost-start', 'recovery-failure'].includes(outcome)) {
        await until(
          () => document.body.innerText.includes('Synthetic lost start response'),
          'Lost start error missing',
        )
        assert(
          document.querySelector('[aria-current=page]')?.textContent === 'Practice',
          'Lost start navigated away',
        )
        if (outcome === 'recovery-failure') {
          click('Reports')
          await new Promise((resolve) => window.setTimeout(resolve, 50))
          assert(
            document.querySelector('[aria-current=page]')?.textContent === 'Practice',
            'Unknown start state was orphaned',
          )
        }
        fail = false
        click('Reports')
      }
      if (outcome === 'failure') {
        await until(
          () => document.body.innerText.includes('Synthetic start failure'),
          'Start failure missing',
        )
        assert(
          document.querySelector('[aria-current=page]')?.textContent === 'Practice',
          'Failed start navigated away',
        )
        fail = false
        await until(
          () =>
            [...document.querySelectorAll('button')].some(
              (b) => b.textContent?.trim() === startLabel && !b.disabled,
            ),
          'Start retry did not become ready',
        )
        click(startLabel)
        await until(() => !!document.querySelector('.quiz-question'), 'Start retry failed')
        click('Reports')
      }
    } else {
      await until(() => !!document.querySelector('.quiz-question'), 'Question did not load')
      await until(
        () =>
          document.querySelector<HTMLInputElement>('.answer-choices input')?.matches(':enabled') ===
          true,
        'Answer did not become ready',
      )
      const choice = document.querySelector<HTMLInputElement>('.answer-choices input')!
      choice.click()
      await new Promise((resolve) => window.setTimeout(resolve, 0))
      if (['pending-save', 'pending-save-failure', 'save-failure'].includes(outcome)) {
        click('Next question')
      }
      if (outcome === 'pending-save' || outcome === 'pending-save-failure') {
        await until(() => mutationStarted, 'Save was not held')
      } else if (outcome === 'save-failure') {
        await until(
          () => document.body.innerText.includes('Synthetic answer failure'),
          'Save failure missing',
        )
      } else {
        await until(
          () => document.querySelector('.answer-save-status')?.textContent === 'Unsaved changes',
          'Answer should remain unsaved',
        )
        const confidence = [
          ...document.querySelectorAll<HTMLInputElement>('.confidence-row input'),
        ].find((input) => input.parentElement?.textContent?.trim() === 'Unsure')!
        confidence.click()
        await new Promise((resolve) => window.setTimeout(resolve, 0))
        await until(
          () => document.querySelector('.answer-save-status')?.textContent === 'Unsaved changes',
          'Confidence should remain unsaved',
        )
        document.querySelector<HTMLInputElement>('.flag-control input')!.click()
        await new Promise((resolve) => window.setTimeout(resolve, 0))
        await until(
          () => document.querySelector('.answer-save-status')?.textContent === 'Unsaved changes',
          'Flag should remain unsaved',
        )
      }
      if (['manual-race', 'resume-race', 'pending-pause-failure'].includes(outcome)) {
        click('Pause')
        if (outcome === 'resume-race') {
          await until(() => !!document.querySelector('.paused-panel'), 'Manual pause failed')
          click(`Resume ${mode}`)
        }
        await until(() => mutationStarted, 'Pause/resume was not held')
      }
      if (outcome === 'submit-race') {
        await openPracticeActions()
        click('Submit and score')
        await until(() => mutationStarted, 'Submit was not held')
      }
      click('Reports')
      if (
        [
          'pending-save',
          'pending-save-failure',
          'pending-pause-failure',
          'manual-race',
          'resume-race',
          'submit-race',
        ].includes(outcome)
      ) {
        await new Promise((resolve) => window.setTimeout(resolve, 50))
        assert(
          document.querySelector('[aria-current=page]')?.textContent === 'Practice',
          'Navigation did not wait for mutation',
        )
        release()
      }
      if (
        [
          'save-failure',
          'pause-failure',
          'lost-pause',
          'pending-save-failure',
          'pending-pause-failure',
        ].includes(outcome)
      ) {
        const message = outcome.includes('save-failure')
          ? 'Synthetic answer failure'
          : 'Synthetic pause failure'
        await until(() => document.body.innerText.includes(message), 'Navigation error missing')
        await new Promise((resolve) => window.setTimeout(resolve, 50))
        assert(
          document.querySelector('[aria-current=page]')?.textContent === 'Practice',
          'Failed suspension left attempt',
        )
        fail = false
        click('Reports')
      }
    }
    await until(() => !!document.querySelector('.reports-page'), 'Navigation did not finish')
    const saved = await attempt()
    assert(saved.id === attemptId, 'Attempt identity changed')
    assert(confirmations === (outcome === 'submit-race' ? 1 : 0), 'Navigation asked to abandon')
    if (outcome === 'submit-race') {
      assert(saved.status === 'completed', 'Pending submission was lost')
      return `${mode}: ${outcome} passed`
    }
    assert(saved.status === 'paused', 'Navigation did not suspend attempt')
    assert(
      saved.pauseHistory.intervals.length === (outcome === 'resume-race' ? 2 : 1),
      'Pause retry duplicated history',
    )
    assert(
      saved.pauseHistory.intervals.at(-1).cause ===
        (outcome === 'manual-race' ? 'manual' : 'navigation'),
      'Pause cause missing',
    )
    if (!['leave', 'failure', 'lost-start', 'recovery-failure'].includes(outcome)) {
      assert(saved.questions[0].selected.length === 1, 'Pending answer was lost')
      if (!['pending-save', 'pending-save-failure', 'save-failure'].includes(outcome)) {
        assert(saved.questions[0].confidence === 'Unsure', 'Confidence was lost')
        assert(saved.questions[0].flagged, 'Review mark was lost')
      }
    }
    const report = await (await workspaceFetch('/api/reports', {}, originalFetch)).json()
    assert(
      !report.attempts.some((item: { id: string }) => item.id === attemptId),
      'Paused attempt entered report',
    )
    await openPracticePreset(mode)
    await until(() => document.body.innerText.includes(`Continue ${mode}`), 'Recovery missing')
    click(`Continue ${mode}`)
    await until(
      () => !!document.querySelector('.paused-panel'),
      'Recovery resumed timer implicitly',
    )
    assert(
      document.querySelector('.attempt-timing')?.textContent?.includes('Pause time'),
      'Pause timing missing',
    )
    click(`Resume ${mode}`)
    await until(() => !!document.querySelector('.quiz-question'), 'Explicit resume failed')
    const resumed = await attempt()
    assert(resumed.status === 'active', 'Resume did not restore active state')
    assert(
      resumed.deadline - resumed.serverNow <= saved.deadline - saved.pausedAt,
      'Resume extended remaining time',
    )
    await openPracticeActions()
    click('Submit and score')
    await until(
      () => document.querySelector('h1')?.textContent === `${title} results`,
      'Submission failed',
    )
    const completed = await attempt()
    const finalReport = await (await workspaceFetch('/api/reports', {}, originalFetch)).json()
    assert(
      finalReport.attempts.filter((item: { id: string }) => item.id === attemptId).length === 1,
      'Completed attempt not counted once',
    )
    assert(
      completed.pauseHistory.intervals.every((p: { endedAt: number | null }) => p.endedAt !== null),
      'Completed pause is still open',
    )
    return `${mode}: ${outcome} passed`
  } finally {
    release()
    window.fetch = originalFetch
    window.confirm = originalConfirm
  }
}
