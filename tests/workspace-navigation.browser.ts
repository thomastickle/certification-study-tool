/** Run against a disposable app to check the study shell and its destinations. */
export async function workspaceNavigationTest() {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  async function until(predicate: () => boolean, message: string) {
    const deadline = Date.now() + 5000
    while (!predicate()) {
      assert(Date.now() < deadline, message)
      await new Promise((resolve) => window.setTimeout(resolve, 10))
    }
  }

  function button(label: string, root: ParentNode = document) {
    const match = [...root.querySelectorAll('button')].find(
      (element) => element.textContent?.trim() === label,
    )
    assert(match && !match.disabled, `Missing enabled button: ${label}`)
    return match
  }

  const nav = document.querySelector('nav[aria-label="Main navigation"]')!
  assert(nav, 'Main navigation is missing')
  assert(
    [...nav.querySelectorAll('button')].at(-1)?.textContent?.trim() === 'Reports',
    'Reports must be the last destination',
  )
  assert(
    !!document.querySelector('button[aria-label="Current certification"]'),
    'The workspace picker must remain available above the global Home metrics',
  )

  button('Home', nav).click()
  await until(() => !!document.querySelector('.home-page'), 'Home did not open')
  assert(!document.querySelector('main .report-stats'), 'Reports are mixed into the home screen')

  button('Certifications', nav).click()
  await until(() => !!document.querySelector('.certifications-page'), 'Certifications did not open')
  assert(
    nav.querySelector('[aria-current="page"]')?.textContent?.trim() === 'Certifications',
    'Certifications navigation selection is incorrect',
  )

  button('Home', nav).click()
  await until(() => !!document.querySelector('.home-page'), 'Home did not reopen')
  for (const destination of [
    { label: 'Practice', target: '.quiz-page' },
    { label: 'Due Review', target: '.quiz-page' },
    { label: 'Importer', target: '.library-page' },
  ]) {
    button(destination.label, nav).click()
    await until(
      () => !!document.querySelector(destination.target),
      `${destination.label} did not open`,
    )
    assert(
      nav.querySelector('[aria-current="page"]')?.textContent?.trim() === destination.label,
      'Navigation selection is incorrect',
    )
    button('Home', nav).click()
    await until(() => !!document.querySelector('.home-page'), 'Home did not reopen')
  }
  button('Reports', nav).click()
  await until(() => !!document.querySelector('.reports-page'), 'Reports did not open separately')
  button('Home', nav).click()
  await until(() => !!document.querySelector('.home-page'), 'Could not return Home')
  assert(
    document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
    'Page overflows horizontally',
  )
  for (const element of nav.querySelectorAll('button')) {
    const bounds = element.getBoundingClientRect()
    assert(bounds.left >= 0 && bounds.right <= innerWidth, 'Navigation is clipped')
  }
  return `Workspace destinations, certification identity and separate Reports passed at ${innerWidth}px`
}
