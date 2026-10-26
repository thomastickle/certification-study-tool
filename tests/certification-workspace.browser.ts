import { workspaceFetch } from './browser-api.ts'

/** Exercise the workspace picker against disposable multi-certification fixtures. */
export async function certificationWorkspaceTest() {
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

  function navigate(label: string) {
    const button = [...document.querySelectorAll<HTMLButtonElement>('nav button')].find(
      (item) => item.textContent?.trim() === label,
    )
    assert(button, `Missing navigation: ${label}`)
    button.click()
  }

  async function choose(query: string, code: string, expectFailure = false) {
    const trigger = document.querySelector<HTMLButtonElement>(
      '[aria-label="Current certification"]',
    )
    assert(trigger, 'Missing certification picker button')
    trigger.click()
    await until(
      () => !!document.querySelector('input[role="combobox"]'),
      'Missing searchable certification combobox',
    )
    const input = document.querySelector<HTMLInputElement>('input[role="combobox"]')
    assert(input, 'Missing searchable certification combobox')
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    setter.call(input, query)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await until(
      () =>
        [...document.querySelectorAll('[role="option"]')].some((item) =>
          item.textContent?.includes(code),
        ),
      `Alias search did not find ${code}`,
    )
    const option = [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')].find(
      (item) => item.textContent?.includes(code),
    )!
    option.click()
    if (expectFailure) {
      await until(
        () => !!document.querySelector('main [role="alert"]'),
        'Failed pause did not report an error',
      )
      return
    }
    await until(() => trigger.textContent?.includes(code) ?? false, 'Selection did not change')
  }

  await until(
    () => !!document.querySelector('[aria-label="Current certification"]'),
    'Picker did not load',
  )
  navigate('Practice')
  await until(() => !!document.querySelector('.quiz-page'), 'Practice did not load')
  await choose('amazon data', 'DEA-C01')
  await until(
    () => document.querySelector('main')?.textContent?.includes('DEA-C01') ?? false,
    'Practice scope missing',
  )
  assert(
    document.querySelector('nav [aria-current="page"]')?.textContent?.trim() === 'Practice',
    'Switch changed page',
  )
  await until(() => !!document.querySelector('.quiz-source-picker'), 'Bank picker did not load')
  navigate('Reports')
  await until(
    () => document.querySelector('.reports-page')?.textContent?.includes('DEA-C01') ?? false,
    'Reports scope missing',
  )
  assert(
    !document.querySelector('.reports-page select[aria-label="Certification"]'),
    'Reports has a competing certification selector',
  )
  await choose('microsoft fundamentals', 'AZ-900')
  await until(
    () => document.querySelector('.reports-page')?.textContent?.includes('AZ-900') ?? false,
    'Reports did not update',
  )
  const stored = localStorage.getItem('study-certification')
  assert(stored?.includes('AZ-900'), 'Selection was not remembered')
  navigate('Practice')
  await choose('amazon data', 'DEA-C01')
  await until(() => !!document.querySelector('.quiz-source-picker'), 'Scoped banks did not load')
  assert(
    document.querySelector('.quiz-source-picker')?.textContent?.includes('synthetic-DEA-C01'),
    'Data Engineer bank missing',
  )
  assert(
    !document.querySelector('.quiz-source-picker')?.textContent?.includes('synthetic-AZ-900'),
    'Azure bank leaked into AWS setup',
  )

  const startButton = () =>
    [...document.querySelectorAll<HTMLButtonElement>('main button')].find(
      (item) => item.textContent?.trim() === 'Start 20-question quiz',
    )

  await until(
    () => !!startButton() && !startButton()!.disabled,
    'Practice start did not become ready',
  )
  startButton()!.click()
  await until(
    () => !!document.querySelector('.answer-choices input:enabled'),
    'Attempt did not become ready for answers',
  )
  document.querySelector<HTMLInputElement>('.answer-choices input')!.click()
  await until(
    () => document.querySelector('main')?.textContent?.includes('Saved') ?? false,
    'Answer did not save',
  )
  const current = await (
    await workspaceFetch('/api/quizzes/current?mode=quiz&provider=AWS&certification=DEA-C01')
  ).json()
  assert(current?.questions[0].selected.length === 1, 'Answer was not persisted')
  const originalFetch = window.fetch
  try {
    window.fetch = (input, init) => {
      if (String(input).endsWith('/pause')) {
        return Promise.resolve(
          new Response(JSON.stringify({ error: 'Synthetic pause failure' }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }
      return originalFetch(input, init)
    }
    await choose('microsoft', 'AZ-900', true)
    assert(
      document
        .querySelector('[aria-label="Current certification"]')
        ?.textContent?.includes('DEA-C01'),
      'Failed pause changed certification',
    )
  } finally {
    window.fetch = originalFetch
  }
  await choose('microsoft', 'AZ-900')
  const paused = await (
    await workspaceFetch('/api/quizzes/current?mode=quiz&provider=AWS&certification=DEA-C01')
  ).json()
  assert(
    paused?.id === current.id && paused.status === 'paused',
    'Certification switch did not pause the original attempt',
  )
  assert(paused.questions[0].selected.length === 1, 'Switch lost the saved answer')
  await choose('amazon data', 'DEA-C01')
  await until(
    () => document.querySelector('main')?.textContent?.includes('Continue quiz') ?? false,
    'Original paused attempt was not recovered',
  )
  await workspaceFetch(`/api/quizzes/${current.id}/abandon`, { method: 'POST' })
  assert(document.documentElement.scrollWidth <= innerWidth + 1, 'Workspace overflows horizontally')
  return 'Alias search, page scoping, persistence, saved-answer pause/recovery, and failed-pause protection passed'
}
