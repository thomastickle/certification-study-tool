/** Run on a disposable database prepared by tests/seed-home.ts. */
export async function homeDashboardTest() {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  async function until(predicate: () => boolean, message: string) {
    const deadline = Date.now() + 8000
    while (!predicate()) {
      assert(Date.now() < deadline, message)
      await new Promise((resolve) => window.setTimeout(resolve, 15))
    }
  }

  function button(label: string, root: ParentNode = document) {
    const element = [...root.querySelectorAll('button')].find(
      (item) => item.textContent?.trim() === label,
    )
    assert(element && !element.disabled, `Missing enabled button: ${label}`)
    return element
  }

  const originalFetch = window.fetch.bind(window)
  const nav = document.querySelector('nav[aria-label="Main navigation"]')!
  button('Home', nav).click()
  await until(
    () => document.querySelectorAll('.provider-card').length === 2,
    'Provider cards did not load',
  )
  const summary = document.querySelector('[aria-label="AWS tracks exam-ready"]')!
  assert(
    summary.getAttribute('aria-valuenow') === '1' && summary.getAttribute('aria-valuemax') === '3',
    'Provider summary must count ready tracks',
  )
  assert(
    document.querySelectorAll('.readiness-neutral').length === 3,
    'Unsupported tracks must stay neutral',
  )
  assert(
    document.querySelector('[aria-label="Earned certification"]'),
    'Seed earned star is missing',
  )
  assert(document.documentElement.scrollWidth <= innerWidth, 'Home overflows horizontally')

  button('Manage certifications').click()
  await until(
    () => document.querySelectorAll('.earned-control input').length === 4,
    'Earned controls did not load',
  )
  const checkbox = document.querySelector<HTMLInputElement>('input[aria-label*="CLF-C02"]')!

  let release = () => {}

  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  let writes = 0
  try {
    window.fetch = async (input, options) => {
      if (String(input).endsWith('/certifications/earned') && options?.method === 'PUT') {
        writes++
        await gate
      }
      return originalFetch(input, options)
    }
    checkbox.click()
    await until(() => checkbox.disabled, 'Earned mutation never became busy')
    assert(
      [...document.querySelectorAll<HTMLInputElement>('.earned-control input')].every(
        (item) => item.disabled,
      ),
      'All settings writes must serialize',
    )
    document.querySelectorAll<HTMLInputElement>('.earned-control input')[1]!.click()
    assert(writes === 1, 'A concurrent earned write escaped serialization')
    release()
    await until(() => !checkbox.disabled && !checkbox.checked, 'Earned update did not persist')
    window.fetch = originalFetch
    button('Home', nav).click()
    await until(() => !!document.querySelector('.provider-card'), 'Home did not reload')
    assert(
      !document.querySelector('[aria-label="Earned certification"]'),
      'Home kept an unearned star',
    )
    assert(
      document
        .querySelector('[aria-label="AWS tracks exam-ready"]')!
        .getAttribute('aria-valuenow') === '1',
      'Earned status changed readiness',
    )

    button('Manage certifications').click()
    await until(
      () => !!document.querySelector('.earned-control input'),
      'Management did not reopen',
    )
    const retry = document.querySelector<HTMLInputElement>('input[aria-label*="CLF-C02"]')!
    window.fetch = async (input, options) => {
      if (String(input).endsWith('/certifications/earned')) {
        return new Response(JSON.stringify({ error: 'Synthetic earned save failure' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return originalFetch(input, options)
    }
    retry.click()
    await until(
      () => !!document.querySelector('[role="alert"]'),
      'Failed earned save was not shown',
    )
    assert(
      !retry.checked && !retry.disabled,
      'A failed save changed the earned choice or blocked retry',
    )
    window.fetch = originalFetch
    retry.click()
    await until(() => retry.checked && !retry.disabled, 'Retry did not save earned status')
    button('Home', nav).click()
    await until(
      () => !!document.querySelector('[aria-label="Earned certification"]'),
      'Earned star did not return',
    )

    button('Reports', nav).click()
    await until(() => !!document.querySelector('.reports-page'), 'Reports did not open')
    window.fetch = async (input, options) => {
      if (String(input).endsWith('/home')) {
        return new Response(JSON.stringify({ error: 'Synthetic home read failure' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return originalFetch(input, options)
    }
    button('Home', nav).click()
    await until(
      () => !!document.querySelector('.home-page [role="alert"]'),
      'Home read failure did not surface',
    )
    window.fetch = originalFetch
    button('Retry').click()
    await until(
      () => document.querySelectorAll('.provider-card').length === 2,
      'Home retry did not recover',
    )
    assert(document.documentElement.scrollWidth <= innerWidth, 'Recovered Home overflows')
    return `Home provider grouping, neutral evidence, earned persistence/serialization/failure, independent readiness and read retry passed at ${innerWidth}px`
  } finally {
    release()
    window.fetch = originalFetch
  }
}
