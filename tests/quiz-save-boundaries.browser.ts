import { workspaceFetch } from './browser-api.ts'

import { openPracticePreset } from './practice-browser-helpers.ts'

/** Exercise deferred saves through the real UI against a disposable populated library. */
export async function quizSaveBoundariesTest(mode: 'quiz' | 'exam', failures = false) {
  const originalFetch = window.fetch
  const originalConfirm = window.confirm
  const total = mode === 'exam' ? 65 : 20
  let attemptId = ''
  let writes = 0
  let rejectSave = false
  window.confirm = () => true

  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message)
  }

  async function until(predicate: () => boolean, message: string) {
    const deadline = Date.now() + 8000
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

  async function snapshot() {
    return (await workspaceFetch(`/api/quizzes/${attemptId}`, {}, originalFetch)).json()
  }

  function actions() {
    document.querySelector<HTMLElement>('.practice-menu summary')!.click()
  }

  async function edit() {
    await until(() => !!document.querySelector('.choice input:enabled'), 'Editor is disabled')
    document.querySelector<HTMLInputElement>('.choice input')!.click()
    document.querySelector<HTMLInputElement>('.confidence-row input')!.click()
    document.querySelector<HTMLInputElement>('.flag-control input')!.click()
    await until(
      () => document.querySelector('.answer-save-status')?.textContent === 'Unsaved changes',
      'Changes should remain unsaved',
    )
  }

  async function boundary(action: () => void, finished: () => boolean) {
    if (failures) {
      rejectSave = true
      const before = writes
      action()
      await until(() => document.body.innerText.includes('Synthetic save failure'), 'Error missing')
      assert(writes === before + 1, 'Failed boundary did not attempt exactly one save')
      assert(!finished(), 'Failed save allowed the action')
      assert((await snapshot()).status === 'active', 'Failed save paused the timer')
      assert(
        document.querySelector('.answer-save-status')?.textContent === 'Unsaved changes',
        'Failed save discarded dirty state',
      )
      rejectSave = false
    }
    const before = writes
    action()
    await until(finished, 'Boundary did not complete')
    assert(writes === before + 1, 'Boundary did not save exactly once')
  }

  window.fetch = async (input, init) => {
    if (String(input).endsWith('/answers') && init?.method === 'PUT') {
      writes++
      if (rejectSave) {
        return new Response(JSON.stringify({ error: 'Synthetic save failure' }), { status: 500 })
      }
    }
    const response = await originalFetch(input, init)
    if (input === '/api/quizzes' && init?.method === 'POST' && response.ok) {
      attemptId = (await response.clone().json()).id
    }
    return response
  }
  try {
    click('Reports')
    await until(() => !!document.querySelector('.reports-page'), 'Reports did not open')
    await openPracticePreset(mode)
    const start = `Start ${total}-question ${mode}`
    await until(
      () =>
        [...document.querySelectorAll('button')].some(
          (button) => button.textContent?.trim() === start && !button.disabled,
        ),
      'Setup did not load',
    )
    click(start)
    await until(() => !!document.querySelector('.quiz-question'), 'Quiz did not start')
    await edit()
    assert(writes === 0, 'Selection, confidence or flag triggered an answer save')
    assert((await snapshot()).questions[0].selected.length === 0, 'Unsaved answer reached server')
    // Cross a real poll interval: status polling must not erase the local edits.
    await new Promise((resolve) => window.setTimeout(resolve, 5200))
    assert(document.querySelector('.choice input:checked'), 'Poll erased the local answer')
    assert(writes === 0, 'Polling triggered a save')
    await boundary(
      () => click('Next question'),
      () => document.querySelector('.practice-progress')?.textContent === `Question 2 of ${total}`,
    )
    const first = (await snapshot()).questions[0]
    assert(
      first.selected.length === 1 && first.confidence === 'Confident' && first.flagged,
      'Next did not persist all local edits',
    )
    await edit()
    await boundary(
      () => click('Previous question'),
      () => document.querySelector('.practice-progress')?.textContent === `Question 1 of ${total}`,
    )
    assert((await snapshot()).questions[1].flagged, 'Previous did not save the second question')
    await edit()
    await boundary(
      actions,
      () => !!document.querySelector<HTMLDetailsElement>('.practice-menu')?.open,
    )
    assert(
      document.querySelector('.answer-save-status')?.textContent === 'Saved',
      'Menu did not save',
    )
    actions()
    await edit()
    await boundary(
      () => click('Pause'),
      () => !!document.querySelector('.paused-panel'),
    )
    assert((await snapshot()).status === 'paused', 'Pause did not stop the server timer')
    click(`Resume ${mode}`)
    await until(() => !!document.querySelector('.quiz-question'), 'Resume failed')
    await edit()
    const expectedFlag = document.querySelector<HTMLInputElement>('.flag-control input')!.checked
    await boundary(
      () => click('Reports'),
      () => !!document.querySelector('.reports-page'),
    )
    const paused = await snapshot()
    assert(paused.status === 'paused', 'Leaving did not pause')
    assert(paused.questions[0].flagged === expectedFlag, 'Leaving did not save the last edit')
    return `${mode}: deferred edits, polling, next/previous, Actions, Pause and leave${failures ? ' with save failures' : ''} passed`
  } finally {
    window.fetch = originalFetch
    rejectSave = false
    if (attemptId) {
      await workspaceFetch(`/api/quizzes/${attemptId}/abandon`, { method: 'POST' }, originalFetch)
    }
    window.confirm = originalConfirm
  }
}
