import { workspaceFetch } from './browser-api.ts'

import { openPracticeActions } from './practice-browser-helpers.ts'

/** Run against a new seed-mastery database from the home screen. Uses only synthetic data. */
export async function masteryBrowserTest(): Promise<string> {
  const originalConfirm = window.confirm
  const createUrl = URL.createObjectURL
  let exported: Blob | undefined
  window.confirm = () => true
  URL.createObjectURL = (value) => {
    if (value instanceof Blob) {
      exported = value
    }
    return createUrl(value)
  }

  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  async function until(predicate: () => boolean, message: string) {
    const deadline = Date.now() + 8000
    while (!predicate()) {
      assert(Date.now() < deadline, message)
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
  }

  function button(label: string) {
    const matches = [...document.querySelectorAll('button')].filter(
      (b) => b.textContent?.trim() === label,
    )
    const result = matches.find((b) => !b.disabled)
    assert(result, `Missing enabled button: ${label}`)
    return result
  }

  async function json(path: string) {
    const response = await workspaceFetch(`/api/${path}`)
    assert(response.ok, `API failed: ${path}`)
    return response.json()
  }

  try {
    const history = await json('quizzes')
    const saved = await json(`quizzes/${history[0].id}`)
    button('Due Review').click()
    await until(() => document.body.textContent?.includes('20 due') === true, 'Due count missing')
    assert(
      document.body.textContent?.includes('no quiz/exam pass target'),
      'Review claims a pass target',
    )
    await until(
      () =>
        [...document.querySelectorAll('button')].some(
          (b) => b.textContent?.trim() === 'Start Due Review (up to 20 questions)' && !b.disabled,
        ),
      'Review setup did not finish loading',
    )
    button('Start Due Review (up to 20 questions)').click()
    await until(() => !!document.querySelector('.choice input:enabled'), 'Review did not start')
    const active = await json('quizzes/current?mode=review')
    const question = active.questions[0]
    const previous = saved.questions.find(
      (q: { question: string }) => q.question === question.question,
    )
    assert(previous, 'Review did not use historical identity')
    const correctTexts = previous.answers
      .filter((a: { id: number }) => previous.correctAnswerIds.includes(a.id))
      .map((a: { text: string }) => a.text)
    for (const [index, choice] of [
      ...document.querySelectorAll<HTMLElement>('.choice'),
    ].entries()) {
      const input = choice.querySelector<HTMLInputElement>('input')!
      const answer = question.answers[index]
      if (answer && correctTexts.includes(answer.text)) {
        input.click()
        await new Promise((resolve) => setTimeout(resolve, 0))
        await until(
          () =>
            document.querySelector('.answer-save-status')?.textContent?.trim() ===
            'Unsaved changes',
          'Choice should remain unsaved',
        )
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
    const confident = [
      ...document.querySelectorAll<HTMLInputElement>('.confidence-row input'),
    ].find((input) => input.parentElement?.textContent?.trim() === 'Confident')
    assert(confident, 'No confidence control')
    confident.click()
    await until(
      () =>
        document.querySelector('.answer-save-status')?.textContent?.trim() === 'Unsaved changes',
      'Answer should remain unsaved',
    )
    button('Reports').click()
    await until(() => !!document.querySelector('.reports-page'), 'Navigation failed')
    assert(
      (await json('quizzes/current?mode=review')).status === 'paused',
      'Navigation did not pause review',
    )
    assert((await json('reports')).attempts.length === 1, 'Paused review entered reports')
    button('Due Review').click()
    await until(
      () =>
        [...document.querySelectorAll('button')].some(
          (b) => b.textContent?.trim() === 'Continue review' && !b.disabled,
        ),
      'Review recovery missing',
    )
    button('Continue review').click()
    await until(() => !!document.querySelector('.paused-panel'), 'Recovered review not paused')
    button('Resume review').click()
    await until(() => !!document.querySelector('.choice input:enabled'), 'Review did not resume')
    const resumed = await json('quizzes/current?mode=review')
    assert(
      resumed.id === active.id && resumed.questions[0].confidence === 'Confident',
      'Recovery lost submitted edits',
    )
    await openPracticeActions()
    button('Submit and score').click()
    await until(() => !!document.querySelector('.result-score'), 'Review did not score')
    assert(
      !document.querySelector('.result-score')?.textContent?.includes('Practice target (80%)'),
      'Review classified a pass/fail',
    )
    const completed = await json(`quizzes/${active.id}`)
    assert(
      completed.correctCount === 1 &&
        completed.questions[0].selected.length === question.selectCount,
      'Submitted answer was not correct',
    )
    const due = await json('quizzes/due')
    assert(
      due.total === 19,
      `Expected one passed check and nineteen skipped due items; got ${due.total}`,
    )
    button('Reports').click()
    await until(
      () => !!document.querySelector('[aria-label="Unique coverage and lifetime mastery"]'),
      'Unique report missing',
    )
    assert(
      document.body.textContent?.includes('Insufficient evidence'),
      'Tiny samples named a weakest domain',
    )
    button('Due Reviews').click()
    await until(
      () =>
        document.querySelector('.report-stats')?.textContent?.includes('0 quiz/exam attempts') ===
        true,
      'Review target denominator included reviews',
    )
    assert(
      document.body.textContent?.includes('20 unique questions encountered'),
      'Unique coverage lost review questions',
    )
    button('↓ Export report').click()
    await until(() => !!exported, 'Report did not export')
    const text = await exported!.text()
    assert(
      text.includes('Due Reviews') &&
        text.includes('Lifetime mastery') &&
        text.includes('Insufficient evidence'),
      'Export lacks review scope/mastery/evidence',
    )
    assert(!text.includes('mastery:v1'), 'Export leaked internal identity')
    return 'Due Review start, answer/confidence save, navigation pause, recovery/resume, grading, skip neutrality, report mode/evidence/mastery and local export passed.'
  } finally {
    window.confirm = originalConfirm
    URL.createObjectURL = createUrl
  }
}
