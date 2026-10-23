import { openPracticePreset } from './practice-browser-helpers.ts'

/** Browser-only fixture checks for stable controls with short and long questions. */
export async function practiceViewportTest(mode: 'quiz' | 'exam'): Promise<string> {
  const originalFetch = window.fetch
  const originalConfirm = window.confirm
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
    if (!String(input).startsWith('/api/quizzes') || !response.ok) return response
    const view = await response.clone().json()
    if (input === '/api/quizzes' && init?.method === 'POST') attemptId = view.id
    if (!view?.questions || view.id !== attemptId) return response
    for (let index = 0; index < 3; index++) {
      const question = view.questions[index]
      const moderate =
        'A company is moving its ordering application to the cloud. Traffic increases during seasonal promotions, and background workers must scale independently. The operations team prefers managed services and needs to preserve accepted orders during an outage. The solution must keep the website responsive during sudden bursts of traffic. Which design best separates incoming requests from background processing?'
      question.question =
        index === 0
          ? 'Which service queues background work?'
          : index === 1
            ? moderate
            : moderate.repeat(8)
      question.sourceName = 'Synthetic layout fixture'
      question.domain = 1
      question.type = 'single_select'
      question.selectCount = 1
      question.answers = Array.from({ length: 4 }, (_, id) => ({
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
    const answerTops: number[] = []
    let typicalLines = 0
    for (let index = 0; index < 3; index++) {
      const expectedStart = index === 0 ? 'Which service' : 'A company'
      await until(
        () =>
          document.querySelector('.quiz-question h2')?.textContent?.startsWith(expectedStart) ===
            true &&
          (index < 2 || document.querySelector('.quiz-question h2')!.textContent!.length > 1000),
        'Question fixture did not load',
      )
      const question = document.querySelector('.quiz-question')!
      if (index === 1) {
        const range = document.createRange()
        range.selectNodeContents(question.querySelector('h2')!)
        typicalLines = range.getClientRects().length
        if (window.innerWidth >= 1100) {
          assert(
            typicalLines >= 3 && typicalLines <= 5,
            'Fixture must exercise a 3–5-line question',
          )
        }
      }
      const choices = document.querySelector('.answer-choices')!
      answerTops.push(choices.getBoundingClientRect().top + window.scrollY)
      for (const element of [question, ...question.querySelectorAll('*')]) {
        const overflow = getComputedStyle(element).overflowY
        assert(overflow !== 'auto' && overflow !== 'scroll', 'Question has a nested scroller')
      }
      const navigation = document.querySelector('.question-navigation')!
      if (index < 2 && window.innerWidth >= 1100 && window.innerHeight >= 740) {
        assert(
          navigation.getBoundingClientRect().bottom <= window.innerHeight,
          'Typical question requires scrolling to navigation',
        )
        assert(
          document.documentElement.scrollHeight <= window.innerHeight,
          'Typical question causes unnecessary page scrolling',
        )
      }
      if (index === 2) {
        assert(
          document.documentElement.scrollHeight > window.innerHeight,
          'Very long question should extend the page',
        )
        navigation.scrollIntoView({ block: 'end' })
        assert(window.scrollY > 0, 'Very long question did not use page scrolling')
      }
      if (index < 2) {
        click('Next question')
      }
    }
    if (window.innerWidth > 760 && typicalLines <= 5) {
      assert(
        Math.abs(answerTops[0]! - answerTops[1]!) < 1,
        'Answers shifted between short and typical questions',
      )
    }
    window.scrollTo(0, 0)
    return `${mode}: stable typical questions and full-page long-content scrolling passed (${typicalLines}-line typical question)`
  } finally {
    window.fetch = originalFetch
    click('Reports')
    await until(() => document.querySelector('.reports-page') !== null, 'Cleanup failed')
    if (attemptId) await originalFetch(`/api/quizzes/${attemptId}/abandon`, { method: 'POST' })
    window.confirm = originalConfirm
  }
}
