/** Run on new tests/seed-home-integration.ts fixtures to exercise Home/picker integration. */
export async function homeCertificationIntegrationTest() {
  function assert(value: unknown, message: string): asserts value {
    if (!value) {
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

  function button(label: string, root: ParentNode = document) {
    const found = [...root.querySelectorAll<HTMLButtonElement>('button')].find(
      (item) => item.textContent?.trim() === label,
    )
    assert(found && !found.disabled, `Missing enabled ${label}`)
    return found
  }

  async function home() {
    button('Home', document.querySelector('nav')!).click()
    await until(() => !!document.querySelector('.provider-card'), 'Home did not load')
  }

  async function choose(code: string) {
    document.querySelector<HTMLButtonElement>('[aria-label="Current certification"]')!.click()
    await until(() => !!document.querySelector('[role="option"]'), 'Picker did not open')
    const option = [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')].find(
      (item) => item.textContent?.includes(code),
    )
    assert(option, `Picker is missing ${code}`)
    option.click()
    await until(
      () =>
        document
          .querySelector('[aria-label="Current certification"]')
          ?.textContent?.includes(code) ?? false,
      'Workspace did not switch',
    )
  }

  async function current(code: string, provider = 'AWS') {
    const response = await fetch(
      `/api/quizzes/current?mode=quiz&provider=${provider}&certification=${code}`,
    )
    assert(response.ok, 'Could not inspect scoped attempt')
    return response.json()
  }

  await home()
  await choose('AZ-900')
  document
    .querySelector<HTMLButtonElement>(
      'button[aria-label="Practice Data Engineer – Associate (DEA-C01)"]',
    )!
    .click()
  await until(
    () => !!document.querySelector('.quiz-page .quiz-source-picker'),
    'Home practice did not open',
  )
  assert(
    document
      .querySelector('[aria-label="Current certification"]')!
      .textContent?.includes('DEA-C01'),
    'Home practice used the old picker scope',
  )
  assert(
    document.querySelector('.quiz-source-picker')!.textContent?.includes('synthetic-DEA-C01'),
    'Home practice did not select its own banks',
  )
  assert(
    !document.querySelector('.quiz-source-picker')!.textContent?.includes('synthetic-AZ-900'),
    'Another certification bank leaked into setup',
  )
  await until(
    () =>
      [...document.querySelectorAll<HTMLButtonElement>('button')].some(
        (item) => item.textContent?.trim() === 'Start 20-question quiz' && !item.disabled,
      ),
    'Start was not ready',
  )
  button('Start 20-question quiz').click()
  await until(
    () => !!document.querySelector('.answer-choices input:enabled'),
    'Practice did not start',
  )
  document.querySelector<HTMLInputElement>('.answer-choices input')!.click()
  await until(
    () => document.querySelector('.answer-save-status')?.textContent === 'Saved',
    'Answer did not save',
  )
  const original = await current('DEA-C01')
  await home()
  assert((await current('DEA-C01')).status === 'paused', 'Home navigation did not pause practice')

  await choose('AZ-900')
  const response = await fetch('/api/quizzes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      provider: 'Azure',
      certification: 'AZ-900',
      mode: 'quiz',
      sourceFilter: 'mixed',
      questionType: 'mixed',
    }),
  })
  assert(response.ok, 'Could not prepare server-owned work on Home')
  const azure = await response.json()
  const originalFetch = window.fetch
  try {
    window.fetch = (input, options) => {
      if (String(input).endsWith(`/quizzes/${azure.id}/pause`)) {
        return Promise.resolve(
          new Response(JSON.stringify({ error: 'Synthetic Home switch pause failure' }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }
      return originalFetch(input, options)
    }
    document
      .querySelector<HTMLButtonElement>(
        'button[aria-label="Practice Data Engineer – Associate (DEA-C01)"]',
      )!
      .click()
    await until(
      () => !!document.querySelector('[role="alert"]'),
      'Failed Home switch was not reported',
    )
    assert(document.querySelector('.provider-card'), 'Failed pause left Home')
    assert(
      document
        .querySelector('[aria-label="Current certification"]')!
        .textContent?.includes('AZ-900'),
      'Failed pause switched workspace',
    )
  } finally {
    window.fetch = originalFetch
  }
  document
    .querySelector<HTMLButtonElement>(
      'button[aria-label="Practice Data Engineer – Associate (DEA-C01)"]',
    )!
    .click()
  await until(
    () => document.querySelector('main')?.textContent?.includes('Continue quiz') ?? false,
    'Home retry did not recover original practice',
  )
  const preserved = await current('DEA-C01')
  assert(
    preserved.id === original.id && preserved.questions[0].selected.length === 1,
    'Home switch lost saved work',
  )
  assert(
    (await current('AZ-900', 'Azure')).status === 'paused',
    'Home switch did not pause server-owned work',
  )
  await home()
  await choose('AZ-900')
  button('Review DEA-C01').click()
  await until(
    () =>
      !!document.querySelector('.quiz-page') &&
      !!document.querySelector('[aria-label="Due retention checks"]'),
    'Home review did not open',
  )
  assert(
    document
      .querySelector('[aria-label="Current certification"]')!
      .textContent?.includes('DEA-C01'),
    'Home review used the old workspace',
  )
  await until(
    () => document.querySelector('main')!.textContent?.includes('65 due') ?? false,
    'Generic due history was not retained',
  )
  await home()
  button('Manage certifications').click()
  await until(
    () => document.querySelectorAll('.earned-control input').length === 4,
    'Earned settings were lost in the merge',
  )
  await home()
  assert(document.documentElement.scrollWidth <= innerWidth, 'Integrated Home overflows')
  return 'Home practice/review target scopes, bank isolation, saved answers, recovered-work pause/failure/retry, global metrics and earned settings passed'
}
