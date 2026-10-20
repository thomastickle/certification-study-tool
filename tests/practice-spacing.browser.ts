/** Browser-only fixture checks for answer spacing and scored-report contrast. */
export async function practiceSpacingTest(mode: 'quiz' | 'exam'): Promise<string> {
  const originalFetch = window.fetch
  const originalConfirm = window.confirm
  const title = mode === 'exam' ? 'Exam' : 'Quiz'
  const total = mode === 'exam' ? 65 : 20
  let attemptId: string | undefined
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

  function click(label: string) {
    const button = [...document.querySelectorAll('button')].find(
      (item) => item.textContent?.trim() === label,
    )
    assert(button && !button.disabled, `Missing enabled button: ${label}`)
    button.click()
  }

  function luminance(color: string): number {
    const channels = color
      .match(/\d+(?:\.\d+)?/g)!
      .slice(0, 3)
      .map(Number)
      .map((channel) => {
        const value = channel / 255
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
      })
    return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722
  }

  window.fetch = async (input, init) => {
    const response = await originalFetch(input, init)
    if (input !== '/api/quizzes' || init?.method !== 'POST' || !response.ok) return response
    const view = await response.json()
    attemptId = view.id
    for (let index = 0; index < 3; index++) {
      const question = view.questions[index]
      question.question = 'Synthetic answer-spacing question?'
      question.sourceName = 'Synthetic layout fixture'
      question.domain = 1
      question.type = 'single_select'
      question.selectCount = 1
      question.answers = Array.from({ length: index + 4 }, (_, id) => ({
        id,
        text: `Choice ${id + 1}`,
      }))
    }
    return new Response(JSON.stringify(view), {
      status: response.status,
      headers: response.headers,
    })
  }
  try {
    await until(() => !!document.querySelector('nav'), 'App did not mount')
    click('Reports')
    await until(() => document.querySelector('.reports-page') !== null, 'Navigation did not finish')
    click(title)
    await until(
      () =>
        [...document.querySelectorAll('button')].some(
          (button) =>
            button.textContent?.trim() === `Start ${total}-question ${mode}` && !button.disabled,
        ),
      'Setup did not load',
    )
    click(`Start ${total}-question ${mode}`)
    await until(() => !!document.querySelector('.answer-choices'), 'Question did not load')
    const tops: number[] = []
    for (let index = 0; index < 3; index++) {
      await until(
        () => document.querySelectorAll('.choice').length === index + 4,
        'Choice fixture did not load',
      )
      tops.push(document.querySelector('.confidence-row')!.getBoundingClientRect().top)
      if (index < 2) click('Next question')
    }
    assert(
      Math.max(...tops) - Math.min(...tops) < 1,
      'Confidence moved between four, five and six choices',
    )
    const clear = document.querySelector('.confidence-clear')!.getBoundingClientRect()
    assert(clear.height <= 30, 'Clear is still oversized')
    assert(
      getComputedStyle(document.querySelector('.quiz-question')!).borderTopWidth === '0px',
      'Outer question border remains',
    )
    assert(
      document.querySelector('.flag-control')?.textContent?.includes('Mark for Review'),
      'Review label is incorrect',
    )
    // Score the real disposable attempt; the layout fixture only changed the browser view.
    const active = await (await originalFetch(`/api/quizzes/${attemptId}`)).json()
    await originalFetch(`/api/quizzes/${attemptId}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        answers: active.questions.map((question: { questionId: number }) => ({
          questionId: question.questionId,
          selected: [],
          confidence: null,
          flagged: false,
        })),
      }),
    })
    window.fetch = originalFetch
    click('Reports')
    await until(
      () => document.querySelector('.reports-page') !== null,
      'Could not leave scored attempt',
    )
    click(title)
    await until(() => !!document.querySelector('.history-list'), 'Result history did not load')
    click('Review results')
    await until(() => !!document.querySelector('.result-correct'), 'Scored report did not load')
    const correct = getComputedStyle(document.querySelector('.result-correct')!)
    const contrast = (luminance(correct.backgroundColor) + 0.05) / (luminance(correct.color) + 0.05)
    assert(contrast >= 7, 'Correct-answer contrast is below the 7:1 readability target')
    assert(parseFloat(correct.fontSize) >= 16, 'Scored answer text is too small')
    return `${mode}: stable 4/5/6-choice spacing, compact Clear, review label and dark report text passed`
  } finally {
    window.fetch = originalFetch
    click('Reports')
    await until(() => document.querySelector('.reports-page') !== null, 'Cleanup navigation failed')
    if (attemptId) await originalFetch(`/api/quizzes/${attemptId}/abandon`, { method: 'POST' })
    window.confirm = originalConfirm
  }
}
