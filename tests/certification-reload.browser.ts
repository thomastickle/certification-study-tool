/** Checks switching from Home with server-owned work recovered after a reload. */
export async function certificationReloadSwitchTest() {
  function assert(value: unknown, message: string): asserts value {
    if (!value) {
      throw new Error(message)
    }
  }

  async function until(predicate: () => boolean) {
    const end = Date.now() + 5000
    while (!predicate()) {
      assert(Date.now() < end, 'Timed out waiting for certification switch')
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
  }

  async function select(code: string) {
    const trigger = document.querySelector<HTMLButtonElement>(
      '[aria-label="Current certification"]',
    )!
    trigger.click()
    await until(() => !!document.querySelector('[role="listbox"]'))
    const option = [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')].find(
      (item) => item.textContent?.includes(code),
    )
    assert(option, `Missing option ${code}`)
    option.click()
  }

  assert(!!document.querySelector('.home-page'), 'Run this check on Home after reloading')
  assert(
    document
      .querySelector('[aria-label="Current certification"]')
      ?.textContent?.includes('DEA-C01'),
    'Reload must restore DEA-C01',
  )
  const originalFetch = window.fetch
  const current = await (
    await fetch('/api/quizzes/current?mode=quiz&provider=AWS&certification=DEA-C01')
  ).json()
  assert(current?.status === 'active', 'Reload precondition requires an active DEA-C01 attempt')
  const exam = await (
    await fetch('/api/quizzes/current?mode=exam&provider=AWS&certification=DEA-C01')
  ).json()
  assert(exam?.status === 'active', 'Reload precondition requires an active DEA-C01 exam')
  try {
    window.fetch = (input, init) => {
      if (String(input).includes('/quizzes/current')) {
        return Promise.resolve(
          new Response(JSON.stringify({ error: 'Synthetic recovery failure' }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }
      return originalFetch(input, init)
    }
    await select('AZ-900')
    await until(
      () =>
        !!document.querySelector('[role="alert"]') ||
        document
          .querySelector('[aria-label="Current certification"]')
          ?.textContent?.includes('AZ-900') === true,
    )
    assert(
      document
        .querySelector('[aria-label="Current certification"]')
        ?.textContent?.includes('DEA-C01'),
      'Failed off-page recovery switched the certification',
    )
    window.fetch = originalFetch
    if (document.querySelector('input[role="combobox"]')) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      await until(() => !document.querySelector('input[role="combobox"]'))
    }
    await select('AZ-900')
    await until(
      () =>
        document
          .querySelector('[aria-label="Current certification"]')
          ?.textContent?.includes('AZ-900') === true,
    )
    const paused = await (await fetch(`/api/quizzes/${current.id}`)).json()
    assert(paused.status === 'paused', 'Switching after reload left the previous timer active')
    assert(
      paused.pauseHistory.intervals.at(-1)?.cause === 'navigation',
      'Recovered pause must record navigation',
    )
    const pausedExam = await (await fetch(`/api/quizzes/${exam.id}`)).json()
    assert(pausedExam.status === 'paused', 'Switching left another mode’s timer active')
    assert(document.querySelector('.home-page'), 'Switch moved away from Home')
    return 'Reload-to-Home switching pauses recovered work; failed recovery retains the certification'
  } finally {
    window.fetch = originalFetch
    await fetch(`/api/quizzes/${current.id}/abandon`, { method: 'POST' })
    await fetch(`/api/quizzes/${exam.id}/abandon`, { method: 'POST' })
  }
}
