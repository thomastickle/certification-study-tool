import { workspaceFetch } from './browser-api.ts'

import { openPracticeActions, openPracticePreset } from './practice-browser-helpers.ts'

/** Browser-only regression, evaluated in the app against a disposable populated database. */
export async function practiceControlsTest(mode: 'quiz' | 'exam'): Promise<string> {
  const total = mode === 'exam' ? 65 : 20
  const originalConfirm = window.confirm
  const title = mode === 'exam' ? 'Exam' : 'Quiz'
  const originalFetch = window.fetch

  let releaseResume = () => {}

  window.confirm = () => true

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

  function button(label: string) {
    const result = [...document.querySelectorAll('button')].find(
      (item) => item.textContent?.trim() === label,
    )
    assert(result && !result.disabled, `Missing enabled button: ${label}`)
    return result
  }

  function saved() {
    return document.querySelector('.answer-save-status')?.textContent?.trim() === 'Saved'
  }

  async function current() {
    return (await workspaceFetch(`/api/quizzes/current?mode=${mode}`)).json()
  }

  try {
    button('Reports').click()
    await until(
      () => document.querySelector('.reports-page') !== null,
      'Could not leave previous screen',
    )
    await openPracticePreset(mode)
    await until(
      () =>
        [...document.querySelectorAll('button')].some(
          (item) =>
            item.textContent?.trim() === `Start ${total}-question ${mode}` && !item.disabled,
        ),
      'Setup did not load',
    )
    button(`Start ${total}-question ${mode}`).click()
    await until(() => !!document.querySelector('.question-navigation'), 'Question did not load')
    assert(!document.querySelector('.page-heading'), 'Redundant active heading is still visible')
    assert(
      /^\d{2}:\d{2}:\d{2}$/.test(document.querySelector('.timer')!.textContent!),
      'Clock does not use HH:MM:SS',
    )
    assert(
      document.querySelector('.question-navigation')?.children.length === 2,
      'Question footer has extra actions',
    )
    assert(
      !document.querySelector('.question-navigation .danger'),
      'Abandon is beside question navigation',
    )
    await until(
      () => document.querySelector<HTMLInputElement>('.choice input')?.matches(':enabled') === true,
      'Answer controls did not become ready',
    )
    const answer = document.querySelector<HTMLInputElement>('.choice input')!
    answer.click()
    await new Promise((resolve) => window.setTimeout(resolve, 0))
    await until(() => !saved(), 'Answer should remain unsaved')
    const confidence = [
      ...document.querySelectorAll<HTMLInputElement>('.confidence-row input'),
    ].find((input) => input.parentElement?.textContent?.trim() === 'Unsure')!
    confidence.click()
    await new Promise((resolve) => window.setTimeout(resolve, 0))
    await until(() => !saved(), 'Confidence should remain unsaved')
    document.querySelector<HTMLInputElement>('.flag-control input')!.click()
    await new Promise((resolve) => window.setTimeout(resolve, 0))
    await until(() => !saved(), 'Flag should remain unsaved')
    button('Next question').click()
    await until(
      () =>
        document.querySelector('.quiz-status')?.textContent?.includes(`Question 2 of ${total}`) ===
        true,
      'Next did not advance',
    )
    button('Previous question').click()
    await until(
      () =>
        document.querySelector('.quiz-status')?.textContent?.includes(`Question 1 of ${total}`) ===
        true,
      'Previous did not return',
    )
    assert(
      document.querySelector<HTMLInputElement>('.choice input')?.checked,
      'Saved answer disappeared',
    )
    await openPracticeActions()
    button('Review answers').click()
    await until(() => !!document.querySelector('.review-list'), 'Review did not open')
    assert(document.querySelectorAll('.review-list li').length === total, 'Review is incomplete')
    const reviewed = document.querySelector('.review-list li')?.textContent ?? ''
    for (const marker of ['Answered', 'Flagged', 'Unsure']) {
      assert(reviewed.includes(marker), `Review lost ${marker} metadata`)
    }
    if (answer.type === 'checkbox') {
      assert(reviewed.includes('Incomplete'), 'Partial multi-select is not labeled incomplete')
    }
    button('Pause').click()
    await until(() => !!document.querySelector('.paused-panel'), 'Pause did not complete')
    const idleUnload = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(idleUnload)
    assert(!idleUnload.defaultPrevented, 'Idle paused attempt should be safe to leave')
    const paused = await current()
    assert(
      paused.status === 'paused' && paused.questions[0].flagged,
      'Server did not persist pause and answers',
    )
    const clock = document.querySelector('.paused-panel h1')?.textContent
    button('Reports').click()
    await until(
      () => document.querySelector('.reports-page') !== null,
      'Paused navigation did not finish',
    )
    await openPracticePreset(mode)
    await until(
      () => !!document.querySelector('.recovery-panel'),
      'Paused attempt was not recoverable',
    )
    button(`Continue ${mode}`).click()
    await until(() => !!document.querySelector('.paused-panel'), 'Paused attempt did not reopen')
    assert(
      document.querySelector('.paused-panel h1')?.textContent === clock,
      'Paused timer kept running',
    )
    let resumeStarted = false
    const delayedResume = new Promise<void>((resolve) => {
      releaseResume = resolve
    })
    window.fetch = async (input, init) => {
      const response = await originalFetch(input, init)
      if (typeof input === 'string' && input.endsWith('/resume')) {
        resumeStarted = true
        await delayedResume
      }
      return response
    }
    button(`Resume ${mode}`).click()
    await until(() => resumeStarted, 'Resume request was not sent')
    const resumingUnload = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(resumingUnload)
    assert(resumingUnload.defaultPrevented, 'Pending resume did not warn before browser unload')
    button('Reports').click()
    await new Promise((resolve) => window.setTimeout(resolve, 50))
    assert(document.querySelector('.paused-panel'), 'Navigation orphaned a pending resume')
    releaseResume()
    await until(
      () => !!document.querySelector('.reports-page'),
      'Navigation did not await resume and suspend the attempt',
    )
    assert((await current()).id === paused.id, 'Resume created a new attempt')
    assert((await current()).status === 'paused', 'Navigation did not suspend the resumed attempt')
    await openPracticePreset(mode)
    await until(
      () => !!document.querySelector('.recovery-panel'),
      'Suspended attempt was not recoverable',
    )
    button(`Continue ${mode}`).click()
    await until(() => !!document.querySelector('.paused-panel'), 'Recovery resumed implicitly')
    button(`Resume ${mode}`).click()
    await until(
      () => !!document.querySelector('.question-navigation'),
      'Resume did not restore question',
    )
    await until(
      () =>
        [...document.querySelectorAll('button')].some(
          (b) => b.textContent?.trim() === `Abandon ${mode}` && !b.disabled,
        ),
      'Resumed actions did not become ready',
    )
    let lostAbandonResponse = false
    window.fetch = async (input, init) => {
      const response = await originalFetch(input, init)
      if (typeof input === 'string' && input.endsWith('/abandon') && !lostAbandonResponse) {
        lostAbandonResponse = true
        throw new TypeError('Synthetic lost abandonment response')
      }
      return response
    }
    await openPracticeActions()
    button(`Abandon ${mode}`).click()
    await until(
      () =>
        document
          .querySelector('.message.error')
          ?.textContent?.includes('Synthetic lost abandonment response') === true,
      'Lost response was not reported',
    )
    await openPracticeActions()
    button(`Abandon ${mode}`).click()
    await until(
      () => document.querySelector('h2')?.textContent === `${title} abandoned`,
      'Menu abandon did not close attempt',
    )
    assert((await current()) === null, 'Abandoned attempt is still recoverable')
    return `${mode}: compact controls, deferred saving, review, pause, recovery, resume and menu abandon passed`
  } finally {
    releaseResume()
    window.fetch = originalFetch
    window.confirm = originalConfirm
  }
}
