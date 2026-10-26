import { workspaceFetch } from './browser-api.ts'
import { openPracticePreset } from './practice-browser-helpers.ts'

/** Verify failed logout retains a disposable quiz and a retry saves/pauses before native submission. */
export async function logoutRecoveryCheck(failure: 'save' | 'pause' | 'submit') {
  const originalFetch = window.fetch
  const form = document.querySelector<HTMLFormElement>('form[action="/auth/logout"]')
  if (!form) {
    throw new Error('Sign in to a disposable populated workspace first.')
  }
  const previousSubmit = Object.getOwnPropertyDescriptor(form, 'submit')
  let id = ''
  let fail = true
  let submissions = 0
  const rejections: unknown[] = []
  const message = `Synthetic logout ${failure} failure`

  function onRejection(event: PromiseRejectionEvent) {
    rejections.push(event.reason)
    event.preventDefault()
  }

  async function until(check: () => boolean, description: string) {
    const deadline = Date.now() + 8000
    while (!check()) {
      if (Date.now() >= deadline) {
        throw new Error(description)
      }
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
  }

  function click(label: string) {
    const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
      (item) => item.textContent?.trim() === label && !item.disabled,
    )
    if (!button) {
      throw new Error(`Missing enabled ${label}`)
    }
    button.click()
  }

  window.addEventListener('unhandledrejection', onRejection)
  try {
    await openPracticePreset('quiz')
    await until(
      () => !!document.querySelector('.practice-setup button.primary:not(:disabled)'),
      'Quiz setup did not load',
    )
    click('Start 20-question quiz')
    await until(
      () => !!document.querySelector('.practice-session .answer-choices input:not(:disabled)'),
      'Quiz did not open',
    )
    const current = await (
      await workspaceFetch('/api/quizzes/current?mode=quiz', {}, originalFetch)
    ).json()
    id = current.id
    document.querySelector<HTMLInputElement>('.answer-choices input')!.click()
    await until(
      () => document.querySelector('.answer-save-status')?.textContent === 'Unsaved changes',
      'The selected answer did not become dirty',
    )

    form.submit = () => {
      if (failure === 'submit' && fail) {
        throw new Error(message)
      }
      submissions++
    }
    window.fetch = async (input, init) => {
      const save = String(input) === `/api/quizzes/${id}/answers` && init?.method === 'PUT'
      const pause = String(input) === `/api/quizzes/${id}/pause` && init?.method === 'POST'
      if (fail && ((failure === 'save' && save) || (failure === 'pause' && pause))) {
        return Response.json({ error: message }, { status: 503 })
      }
      return originalFetch(input, init)
    }

    click('Sign out')
    await until(
      () =>
        [...document.querySelectorAll('[role="alert"], .message.error')].some((element) =>
          element.textContent?.includes(message),
        ),
      'Logout failure was not shown',
    )
    const session = await (await originalFetch('/api/session')).json()
    if (!session.user || submissions !== 0 || !document.querySelector('.practice-session')) {
      throw new Error('Failed logout must retain the signed-in practice workspace')
    }
    const retained = await (await workspaceFetch(`/api/quizzes/${id}`, {}, originalFetch)).json()
    const expected = failure === 'submit' ? 'paused' : 'active'
    if (retained.status !== expected) {
      throw new Error('Failed logout lost the current attempt')
    }

    fail = false
    click('Sign out')
    await until(() => submissions === 1, 'Logout retry did not reach native form submission')
    const saved = await (await workspaceFetch(`/api/quizzes/${id}`, {}, originalFetch)).json()
    if (
      saved.status !== 'paused' ||
      saved.questions[0].selected.length !== 1 ||
      saved.pauseHistory.intervals.length !== 1
    ) {
      throw new Error('Logout retry must save the answer and pause exactly once')
    }
    if (rejections.length) {
      throw new Error('Logout caused an unhandled rejection')
    }
    return { failure, feedbackShown: true, retrySavedAndPausedOnce: true, nativeSubmissions: 1 }
  } finally {
    window.fetch = originalFetch
    if (previousSubmit) {
      Object.defineProperty(form, 'submit', previousSubmit)
    } else {
      delete (form as Partial<HTMLFormElement>).submit
    }
    window.removeEventListener('unhandledrejection', onRejection)
    if (id) {
      await workspaceFetch(
        `/api/quizzes/${id}/abandon`,
        { method: 'POST', body: '{}' },
        originalFetch,
      )
    }
  }
}
