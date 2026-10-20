/** Run in the browser against a disposable app, starting on its home page. */
export async function homeNavigationTest() {
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

  function click(label: string, container: ParentNode = document) {
    const button = [...container.querySelectorAll('button')].find((item) => {
      const content = item.cloneNode(true) as HTMLElement
      content.querySelectorAll('[aria-hidden="true"]').forEach((node) => node.remove())
      return content.textContent?.trim() === label
    })
    assert(button && !button.disabled, `Missing enabled button: ${label}`)
    button.click()
  }

  function checkCertification() {
    const identity = document.querySelector('[aria-label="Practice certification"]')
    assert(identity?.textContent?.includes('Cloud Practitioner'), 'Certification name is missing')
    assert(identity?.textContent?.includes('CLF-C02'), 'Certification code is missing')
  }

  assert(
    document.querySelector('h1')?.textContent === 'Cloud Practitioner',
    'Home must name the certification',
  )
  checkCertification()
  const nav = document.querySelector('nav[aria-label="Main navigation"]')!
  const navBounds = nav.getBoundingClientRect()
  for (const button of nav.querySelectorAll('button')) {
    assert(
      button.getBoundingClientRect().right <= navBounds.right + 1,
      'Navigation exceeds its container',
    )
  }
  assert(nav.querySelector('[aria-current="page"]')?.textContent === 'Home', 'Home is not active')
  assert(
    document.body.textContent?.includes('currently supports AWS Cloud Practitioner'),
    'Practice scope is unclear',
  )

  const destinations = [
    { action: 'Set up a quiz', nav: 'Quiz', target: '.quiz-page' },
    { action: 'Set up an exam', nav: 'Exam', target: '.quiz-page' },
    { action: 'Review due questions', nav: 'Due Review', target: '.quiz-page' },
    { action: 'View reports', nav: 'Reports', target: '.reports-page' },
    { action: 'Manage question banks', nav: 'Importer', target: '.library-layout' },
  ]
  for (const destination of destinations) {
    click(destination.action)
    await until(
      () => !!document.querySelector(destination.target),
      `${destination.nav} did not open`,
    )
    assert(
      nav.querySelector('[aria-current="page"]')?.textContent === destination.nav,
      'Wrong active navigation item',
    )
    checkCertification()
    click('Home', nav)
    await until(
      () => document.querySelector('h1')?.textContent === 'Cloud Practitioner',
      'Home did not reopen',
    )
  }
  assert(document.documentElement.scrollWidth <= window.innerWidth, 'Home overflows the viewport')
  return `Home identity and all five destinations passed at ${window.innerWidth}px`
}
