/** Browser-only reading/layout regression; use a disposable populated database. */
export async function practiceReadingTest(mode: 'quiz' | 'exam'): Promise<string> {
  const title = mode === 'exam' ? 'Exam' : 'Quiz'
  const total = mode === 'exam' ? 65 : 20
  const originalConfirm = window.confirm
  const originalNow = Date.now
  const originalFetch = window.fetch
  const originalSetTimeout = window.setTimeout
  const warningDismissals: (() => void)[] = []
  window.setTimeout = ((handler: TimerHandler, delay?: number, ...args: unknown[]) => {
    if (delay === 30_000 && typeof handler === 'function') {
      warningDismissals.push(() => handler(...args))
    }
    return originalSetTimeout(handler, delay, ...args)
  }) as typeof window.setTimeout
  let attemptId: string | undefined
  window.confirm = () => true

  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  async function until(predicate: () => boolean, message: string) {
    const deadline = originalNow() + 5000
    while (!predicate()) {
      assert(originalNow() < deadline, message)
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

  try {
    await until(
      () =>
        [...document.querySelectorAll('button')].some(
          (item) => item.textContent?.trim() === 'Reports',
        ),
      'App did not mount',
    )
    click('Reports')
    await until(() => document.querySelector('.reports-page') !== null, 'Navigation did not finish')
    click(title)
    await until(
      () =>
        [...document.querySelectorAll('button')].some(
          (item) =>
            item.textContent?.trim() === `Start ${total}-question ${mode}` && !item.disabled,
        ),
      'Setup did not load',
    )
    click(`Start ${total}-question ${mode}`)
    await until(() => !!document.querySelector('.question-navigation'), 'Question did not open')
    const attempt = await (await originalFetch(`/api/quizzes/current?mode=${mode}`)).json()
    attemptId = attempt.id
    await until(
      () => !!document.querySelector('.choice input:enabled'),
      'Answer inputs did not become ready',
    )
    for (let index = 0; index < attempt.questions[0].selectCount; index++) {
      document.querySelectorAll<HTMLInputElement>('.choice input')[index]!.click()
      await new Promise((resolve) => window.setTimeout(resolve, 0))
      await until(
        () => document.querySelector('.answer-save-status')?.textContent?.trim() === 'Saved',
        'Answer did not save',
      )
    }
    const confident = [
      ...document.querySelectorAll<HTMLInputElement>('.confidence-row input'),
    ].find((input) => input.parentElement?.textContent?.trim() === 'Confident')!
    confident.click()
    await new Promise((resolve) => window.setTimeout(resolve, 0))
    await until(
      () => document.querySelector('.answer-save-status')?.textContent?.trim() === 'Saved',
      'Confidence did not save',
    )
    document.querySelector<HTMLElement>('.practice-menu summary')!.click()
    click('Review answers')
    await until(() => !!document.querySelector('.review-list'), 'Review did not open')
    assert(
      !document.querySelector('.review-list li')?.classList.contains('needs-review'),
      'Complete confident answer was highlighted',
    )
    assert(
      document.querySelectorAll('.review-list li')[1]?.classList.contains('needs-review'),
      'Unanswered item was not highlighted',
    )
    click(`Question ${total}`)
    await until(
      () =>
        document
          .querySelector('.quiz-status')
          ?.textContent?.includes(`Question ${total} of ${total}`) === true,
      'Last question did not open',
    )
    const finalButton = document.querySelectorAll<HTMLButtonElement>(
      '.question-navigation button',
    )[1]!
    assert(
      finalButton.textContent?.trim() === 'Review answers',
      'Final question action is mislabeled',
    )
    finalButton.click()
    await until(() => !!document.querySelector('.review-list'), 'Final button did not open review')
    const attention = document.querySelector('.review-list li.needs-review')
    assert(
      attention?.textContent?.includes('Needs review'),
      'Review questions are not marked for attention',
    )
    click('Question 1')
    await until(() => !!document.querySelector('.quiz-question'), 'Question did not reopen')
    const confidence = document.querySelector('.confidence-row fieldset')!.getBoundingClientRect()
    const flag = document.querySelector('.flag-control')!.getBoundingClientRect()
    assert(flag.top >= confidence.bottom, 'Review mark is not under Confidence')
    assert(
      document.querySelector('.flag-control')?.textContent?.includes('Mark for Review'),
      'Review mark label is outdated',
    )
    assert(document.querySelector('.selection-instruction strong'), 'Selection count is not bold')
    const navigation = document.querySelector('.question-navigation')!.getBoundingClientRect()
    const buttons = document.querySelectorAll('.question-navigation button')
    const previous = buttons[0]!.getBoundingClientRect()
    const next = buttons[1]!.getBoundingClientRect()
    assert(
      previous.width < navigation.width / 2 && next.width < navigation.width / 2,
      'Question buttons still stretch',
    )
    assert(
      Math.abs(previous.left - navigation.left) < 1 && Math.abs(next.right - navigation.right) < 1,
      'Question navigation is not aligned to opposite edges',
    )
    assert(
      parseFloat(getComputedStyle(document.querySelector('.choice')!).fontSize) >= 16,
      'Answer text is too small',
    )
    const questionTop = document.querySelector('.quiz-question')!.getBoundingClientRect().top
    const initialNow = originalNow()
    let clockNow = initialNow
    Date.now = () => clockNow
    clockNow = initialNow + (attempt.deadline - attempt.serverNow) - 599_000
    await until(
      () =>
        document.querySelector('.timer-warning')?.textContent?.includes('10 min remaining') ===
        true,
      '10-minute warning did not appear inline',
    )
    assert(
      Math.abs(
        document.querySelector('.quiz-question')!.getBoundingClientRect().top - questionTop,
      ) < 1,
      'Warning shifted the question',
    )
    assert(warningDismissals.length === 1, 'Warning did not schedule a 30-second dismissal')
    warningDismissals[0]!()
    await until(
      () => document.querySelector('.timer-warning')?.classList.contains('pending') === true,
      'Warning did not disappear after dismissal',
    )
    assert(
      Math.abs(
        document.querySelector('.quiz-question')!.getBoundingClientRect().top - questionTop,
      ) < 1,
      'Dismissing warning shifted question',
    )
    clockNow = initialNow + (attempt.deadline - attempt.serverNow) - 119_000
    await until(
      () =>
        document
          .querySelector('.timer-warning.urgent')
          ?.textContent?.includes('2 min remaining') === true,
      'Final warning did not become urgent',
    )
    assert(
      Math.abs(
        document.querySelector('.quiz-question')!.getBoundingClientRect().top - questionTop,
      ) < 1,
      'Urgent warning shifted the question',
    )
    assert(warningDismissals[1], 'Final warning did not schedule its own dismissal')
    warningDismissals[1]!()
    await until(
      () => document.querySelector('.timer-warning')?.classList.contains('pending') === true,
      'Final warning did not disappear',
    )
    return `${mode}: reading layout, final-question review, yellow attention, and stable warnings passed`
  } finally {
    Date.now = originalNow
    window.setTimeout = originalSetTimeout
    if (attemptId) {
      await originalFetch(`/api/quizzes/${attemptId}/abandon`, { method: 'POST' })
      click('Reports')
      await until(
        () => document.querySelector('.reports-page') !== null,
        'Cleanup navigation failed',
      )
    }
    window.confirm = originalConfirm
  }
}
