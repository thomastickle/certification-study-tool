import { openPracticePreset } from './practice-browser-helpers.ts'

/** Browser-only fixture checks for stable controls with short and long questions. */
export async function practiceViewportTest(mode: 'quiz' | 'exam'): Promise<string> {
  const originalFetch = window.fetch
  const originalConfirm = window.confirm
  const bounded = window.innerWidth > 760 && window.innerHeight > 500
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

  window.fetch = async (input, init) => {
    const response = await originalFetch(input, init)
    if (input !== '/api/quizzes' || init?.method !== 'POST' || !response.ok) return response
    const view = await response.json()
    attemptId = view.id
    for (let index = 0; index < 3; index++) {
      const question = view.questions[index]
      question.question =
        index === 1
          ? 'A company is evaluating its cloud architecture. '.repeat(35) +
            'Which option meets the requirement?'
          : 'Synthetic short question?'
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
    await openPracticePreset(mode)
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
      const navigation = document.querySelector('.question-navigation')!.getBoundingClientRect()
      if (bounded) {
        assert(navigation.bottom <= window.innerHeight, 'Navigation fell below the viewport')
      } else {
        const reading = document.querySelector('.question-reading')!
        assert(
          reading.scrollHeight <= reading.clientHeight + 1,
          'Small viewport clipped reading content instead of using page scrolling',
        )
        document.querySelector('.question-navigation')!.scrollIntoView({ block: 'end' })
        assert(
          document.querySelector('.question-navigation')!.getBoundingClientRect().bottom <=
            window.innerHeight + 1,
          'Small viewport navigation cannot be reached',
        )
        window.scrollTo(0, 0)
      }
      if (index === 1 && bounded) {
        const reading = document.querySelector('.question-reading')!
        assert(reading.scrollHeight > reading.clientHeight, 'Long question should scroll')
        reading.scrollTop = reading.scrollHeight
        assert(reading.scrollTop > 0, 'Long question cannot be scrolled')
      }
      if (index === 2) {
        assert(
          document.querySelector('.question-reading')!.scrollTop === 0,
          'Next question retained the previous scroll position',
        )
      }
      if (index < 2) click('Next question')
    }
    assert(
      !bounded || Math.max(...tops) - Math.min(...tops) < 1,
      'Confidence moved between short and long questions',
    )
    return `${mode}: stable controls passed`
  } finally {
    window.fetch = originalFetch
    click('Reports')
    await until(() => document.querySelector('.reports-page') !== null, 'Cleanup failed')
    if (attemptId) await originalFetch(`/api/quizzes/${attemptId}/abandon`, { method: 'POST' })
    window.confirm = originalConfirm
  }
}
