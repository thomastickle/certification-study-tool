/** Completed result views expose both a top-level return and a working Practice destination. */
export async function resultNavigationCheck() {
  /** Waits for the public view rather than relying on route implementation details. */
  async function until(check: () => boolean, message: string) {
    const deadline = Date.now() + 5000
    while (!check()) {
      if (Date.now() >= deadline) {
        throw new Error(message)
      }
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
  }

  /** Uses the persistent workspace navigation, including reselecting the current destination. */
  function navigate(label: string) {
    const button = [...document.querySelectorAll<HTMLButtonElement>('nav button')].find(
      (item) => item.textContent?.trim() === label,
    )!
    button.click()
  }

  navigate('Home')
  await until(() => !!document.querySelector('.home-page'), 'Home did not open')
  navigate('Practice')
  await until(() => !!document.querySelector('.completed-results a'), 'History did not load')
  const id = document
    .querySelector('.completed-results a')!
    .closest('li')!
    .getAttribute('data-result-id')!
  for (const action of ['Practice', 'Back']) {
    document.querySelector<HTMLAnchorElement>(`a[href="#result-${id}"]`)!.click()
    await until(() => !!document.querySelector('.result-score'), 'Result did not open')
    if (action === 'Practice') {
      navigate('Practice')
    } else {
      const back = document.querySelector<HTMLButtonElement>('.result-back-link')
      if (!back) {
        throw new Error('Missing Back link above the result summary')
      }
      back.click()
    }
    await until(
      () => !!document.querySelector('.practice-setup') && !document.querySelector('.result-score'),
      `${action} must return from results to practice setup`,
    )
    await until(() => !!document.querySelector(`a[href="#result-${id}"]`), 'Result history lost')
  }
  return 'Practice reselect and the top Back link return results to setup without losing history.'
}

/** Reselecting Practice must preserve the existing save/pause guard for a running attempt. */
export async function practiceReselectSafetyCheck() {
  const originalFetch = window.fetch
  let id = ''
  let rejectedSave = false
  let rejectSave = true

  /** Waits for the real app and server to settle before checking navigation. */
  async function until(check: () => boolean, message: string) {
    const deadline = Date.now() + 8000
    while (!check()) {
      if (Date.now() >= deadline) {
        throw new Error(message)
      }
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
  }

  /** Activates a named button without bypassing app navigation. */
  function click(label: string) {
    const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
      (item) => item.textContent?.trim() === label && !item.disabled,
    )
    if (!button) {
      throw new Error(`Missing enabled ${label}`)
    }
    button.click()
  }

  try {
    click('Home')
    await until(() => !!document.querySelector('.home-page'), 'Home missing')
    click('Practice')
    await until(
      () => !!document.querySelector('.practice-setup button.primary:not(:disabled)'),
      'Setup did not load',
    )
    click('Start 20-question quiz')
    await until(() => !!document.querySelector('.practice-session'), 'Question did not open')
    const current = await (await originalFetch('/api/quizzes/current?mode=quiz')).json()
    id = current.id
    window.fetch = async (input, init) => {
      if (String(input) === `/api/quizzes/${id}/answers` && init?.method === 'PUT' && rejectSave) {
        rejectedSave = true
        return new Response(JSON.stringify({ error: 'Synthetic failed save' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return originalFetch(input, init)
    }
    click('Practice')
    await until(
      () => rejectedSave && !!document.querySelector('.practice-session .message.error'),
      'Practice reselect bypassed the save guard',
    )
    const stillActive = await (await originalFetch(`/api/quizzes/${id}`)).json()
    if (stillActive.status !== 'active' || document.querySelector('.practice-setup')) {
      throw new Error('Failed save must keep the running attempt open')
    }
    rejectSave = false
    click('Practice')
    await until(
      () => !!document.querySelector('.practice-setup'),
      'Practice retry did not return to setup',
    )
    const paused = await (await originalFetch(`/api/quizzes/${id}`)).json()
    if (paused.status !== 'paused' || paused.pauseHistory?.intervals.length !== 1) {
      throw new Error('Practice reselect must save and pause once before returning to setup')
    }
    return 'Practice reselect retains failed saves, then safely pauses the active attempt on retry.'
  } finally {
    window.fetch = originalFetch
    if (id) {
      await originalFetch(`/api/quizzes/${id}/abandon`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
    }
  }
}
