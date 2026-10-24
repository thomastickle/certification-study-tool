import { workspaceFetch } from './browser-api.ts'

/** Exercise the shared Practice entry against a disposable populated database. */
export async function practicePresetsTest() {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message)
  }

  async function until(predicate: () => boolean, message: string) {
    const end = Date.now() + 6000
    while (!predicate()) {
      assert(Date.now() < end, message)
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
  }

  function button(label: string) {
    const match = [...document.querySelectorAll('button')].find(
      (item) => item.textContent?.trim() === label,
    )
    assert(match, `Missing button: ${label}`)
    return match
  }

  async function preset(mode: 'quiz' | 'exam') {
    const input = document.querySelector<HTMLInputElement>(
      `input[name="practice-preset"][value="${mode}"]`,
    )
    assert(input && !input.disabled, `Missing preset: ${mode}`)
    input.focus()
    input.click()
    await until(
      () => !!document.querySelector(`input[name="practice-preset"][value="${mode}"]:checked`),
      `Preset did not switch to ${mode}`,
    )
    assert(
      document.activeElement === document.querySelector(`${selectorForPreset(mode)}:checked`),
      'Changing presets lost keyboard focus',
    )
    await until(
      () => !document.body.textContent?.includes('Loading question banks'),
      'Sources pending',
    )
  }

  function selectorForPreset(mode: 'quiz' | 'exam') {
    return `input[name="practice-preset"][value="${mode}"]`
  }

  async function reports() {
    button('Reports').click()
    await until(() => !!document.querySelector('.reports-page'), 'Reports did not open')
  }

  const attempts: string[] = []
  try {
    const nav = document.querySelector('nav[aria-label="Main navigation"]')!
    assert(
      [...nav.querySelectorAll('button')].some((item) => item.textContent?.trim() === 'Practice'),
      'Practice must be a single navigation destination',
    )
    assert(
      ![...nav.querySelectorAll('button')].some((item) =>
        ['Quiz', 'Exam'].includes(item.textContent!.trim()),
      ),
      'Quiz and Exam still have separate navigation entries',
    )
    button('Practice').click()
    await until(() => !!document.querySelector('[name="practice-preset"]'), 'Presets did not load')
    await preset('exam')
    await until(() => !button('Start 65-question exam').disabled, 'Exam setup not ready')
    assert(
      document
        .querySelector('[value="exam"]')
        ?.closest('label')
        ?.textContent?.includes('90 minutes'),
      'Exam time changed',
    )

    document.querySelector<HTMLButtonElement>('.source-picker-trigger')!.click()
    button('Clear').click()
    button('Done').click()
    await preset('quiz')
    assert(button('Start 20-question quiz').disabled, 'Changing presets reset the bank selection')
    document.querySelector<HTMLButtonElement>('.source-picker-trigger')!.click()
    button('Select all').click()
    button('Done').click()
    await until(() => !button('Start 20-question quiz').disabled, 'Quiz setup not ready')
    assert(
      document
        .querySelector('[value="quiz"]')
        ?.closest('label')
        ?.textContent?.includes('20 minutes'),
      'Quiz time changed',
    )

    button('Start 20-question quiz').click()
    await until(() => !!document.querySelector('.quiz-question'), 'Quiz did not start')
    assert(
      !document.querySelector('[name="practice-preset"]'),
      'Active attempt allows preset mutation',
    )
    const quiz = await (await workspaceFetch('/api/quizzes/current?mode=quiz')).json()
    attempts.push(quiz.id)
    assert(quiz.questions.length === 20, 'Quiz question count changed')
    document.querySelector<HTMLInputElement>('.choice input')!.click()
    await new Promise((resolve) => setTimeout(resolve, 50))
    await until(
      () => document.querySelector('.answer-save-status')?.textContent === 'Unsaved changes',
      'Answer should remain unsaved',
    )
    await reports()
    button('Practice').click()
    await until(() => !!document.querySelector('.recovery-panel'), 'Quiz recovery missing')
    await preset('exam')
    await until(() => !button('Start 65-question exam').disabled, 'Exam preset not ready')
    const pausedQuiz = await (await workspaceFetch(`/api/quizzes/${quiz.id}`)).json()
    assert(pausedQuiz.status === 'paused', 'Preset change lost the paused quiz')
    assert(pausedQuiz.questions[0].selected.length === 1, 'Saved quiz answer lost')

    button('Start 65-question exam').click()
    await until(() => !!document.querySelector('.quiz-question'), 'Exam did not start')
    const exam = await (await workspaceFetch('/api/quizzes/current?mode=exam')).json()
    attempts.push(exam.id)
    assert(exam.questions.length === 65, 'Exam question count changed')
    await reports()
    button('Practice').click()
    await until(() => !!document.querySelector('.recovery-panel'), 'Exam recovery missing')
    assert(
      document.querySelector('.recovery-panel')?.textContent?.includes('exam'),
      'Practice forgot its preset',
    )
    await preset('quiz')
    await until(
      () => !!document.querySelector('.recovery-panel'),
      'Quiz recovery missing after preset switch',
    )
    button('Continue quiz').click()
    await until(() => !!document.querySelector('.paused-panel'), 'Saved quiz did not reopen paused')
    return 'Shared Practice entry, preset counts/times, bank selection and independent attempt recovery passed'
  } finally {
    await reports()
    for (const id of attempts)
      await workspaceFetch(`/api/quizzes/${id}/abandon`, { method: 'POST' })
  }
}
