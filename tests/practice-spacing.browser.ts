import { workspaceFetch } from './browser-api.ts'

import { openPracticePreset } from './practice-browser-helpers.ts'

/** Browser-only fixture checks for answer spacing and scored-report contrast. */
export async function practiceSpacingTest(
  mode: 'quiz' | 'exam',
  typical = false,
  wrapped = false,
): Promise<string> {
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
    if (!String(input).startsWith('/api/quizzes') || !response.ok) return response
    const view = await response.clone().json()
    if (input === '/api/quizzes' && init?.method === 'POST') attemptId = view.id
    if (!view?.questions || view.id !== attemptId) return response
    for (let index = 0; index < 3; index++) {
      const question = view.questions[index]
      question.question = typical
        ? 'A company is moving its ordering application to the cloud. Traffic increases during seasonal promotions, and background workers must scale independently. The operations team prefers managed services and needs to preserve accepted orders during an outage. The solution must keep the website responsive during sudden bursts of traffic. Which design best separates incoming requests from background processing?'
        : 'Synthetic answer-spacing question?'
      question.sourceName = 'Synthetic layout fixture'
      question.domain = 1
      question.type = 'single_select'
      question.selectCount = 1
      question.answers = Array.from({ length: index + 4 }, (_, id) => ({
        id,
        text:
          wrapped && index === 2 && id === 5
            ? 'This longer answer describes a managed service with independent workers and durable messages. '.repeat(
                4,
              )
            : `Choice ${id + 1}`,
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
    const confidenceTops: number[] = []
    const lastAnswerBottoms: number[] = []
    for (let index = 0; index < 3; index++) {
      await until(
        () => document.querySelectorAll('.choice').length === index + 4,
        'Choice fixture did not load',
      )
      tops.push(document.querySelector('.answer-choices')!.getBoundingClientRect().top)
      const confidence = document.querySelector('.confidence-row')!.getBoundingClientRect()
      const lastChoice = [...document.querySelectorAll('.choice')].at(-1)!.getBoundingClientRect()
      assert(confidence.top - lastChoice.bottom >= 12, 'Answers crowd the confidence controls')
      confidenceTops.push(confidence.top)
      lastAnswerBottoms.push(lastChoice.bottom)
      if (wrapped && index === 2) {
        const range = document.createRange()
        range.selectNodeContents(document.querySelectorAll('.choice')[5]!.lastElementChild!)
        assert(range.getClientRects().length > 1, 'Wrapped-answer fixture did not wrap')
      }
      const toolbar = document.querySelector('.quiz-status')!
      assert(toolbar.scrollWidth <= toolbar.clientWidth + 1, 'Toolbar overflows its width')
      if (index < 2 && window.innerWidth >= 1100 && window.innerHeight >= 740) {
        assert(
          document.querySelector('.question-navigation')!.getBoundingClientRect().bottom <=
            window.innerHeight,
          'Four or five answers should fit without scrolling',
        )
        assert(
          document.documentElement.scrollHeight <= window.innerHeight,
          `Four or five answers cause unnecessary page scrolling: ${document.documentElement.scrollHeight}px in ${window.innerHeight}px`,
        )
      }
      if (index < 2) click('Next question')
    }
    assert(
      Math.max(...tops) - Math.min(...tops) < 1,
      'Answer start moved between four, five and six choices',
    )
    if (window.innerWidth > 760) {
      assert(
        Math.abs(confidenceTops[0]! - confidenceTops[1]!) < 1,
        'Confidence moved between four and five choices',
      )
      assert(
        confidenceTops[2]! > confidenceTops[1]!,
        'Sixth choice should grow the page before Confidence',
      )
      assert(
        confidenceTops[0]! - lastAnswerBottoms[0]! >=
          lastAnswerBottoms[1]! - lastAnswerBottoms[0]! + 12,
        'Four-choice question did not reserve a fifth row',
      )
    }
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
    const active = await (
      await workspaceFetch(`/api/quizzes/${attemptId}`, {}, originalFetch)
    ).json()
    await workspaceFetch(
      `/api/quizzes/${attemptId}/submit`,
      {
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
      },
      originalFetch,
    )
    window.fetch = originalFetch
    click('Reports')
    await until(
      () => document.querySelector('.reports-page') !== null,
      'Could not leave scored attempt',
    )
    await openPracticePreset(mode)
    await until(() => !!document.querySelector('.history-list'), 'Result history did not load')
    await until(
      () => !!document.querySelector(`[data-result-id="${attemptId}"] a`),
      'Scored result link did not load',
    )
    const result = document.querySelector<HTMLAnchorElement>(`[data-result-id="${attemptId}"] a`)
    assert(result, 'Scored result link did not load')
    result.click()
    await until(() => !!document.querySelector('.result-correct'), 'Scored report did not load')
    const correct = getComputedStyle(document.querySelector('.result-correct')!)
    const contrast = (luminance(correct.backgroundColor) + 0.05) / (luminance(correct.color) + 0.05)
    assert(contrast >= 7, 'Correct-answer contrast is below the 7:1 readability target')
    assert(parseFloat(correct.fontSize) >= 16, 'Scored answer text is too small')
    return `${mode}: ${typical ? 'typical' : 'short'} question, five reserved rows, ${wrapped ? 'wrapped sixth answer' : 'sixth row'} grows naturally, compact Clear, review label and dark report text passed`
  } finally {
    window.fetch = originalFetch
    click('Reports')
    await until(() => document.querySelector('.reports-page') !== null, 'Cleanup navigation failed')
    if (attemptId)
      await workspaceFetch(`/api/quizzes/${attemptId}/abandon`, { method: 'POST' }, originalFetch)
    window.confirm = originalConfirm
  }
}
