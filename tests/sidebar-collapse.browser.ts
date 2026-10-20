/** Run at desktop width against a disposable app; restore the original sidebar state. */
export async function sidebarCollapseTest() {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message)
  }

  function toggle() {
    const button = document.querySelector<HTMLButtonElement>('.sidebar-toggle')
    assert(button, 'Sidebar collapse control is missing')
    return button
  }

  async function settle() {
    await new Promise((resolve) => window.setTimeout(resolve, 50))
  }

  assert(innerWidth > 760, 'Use a desktop viewport for the collapse test')
  const originallyExpanded = toggle().getAttribute('aria-expanded') === 'true'
  try {
    if (!originallyExpanded) {
      toggle().click()
      await settle()
    }
    const sidebar = document.querySelector<HTMLElement>('.workspace-sidebar')!
    const wide = sidebar.getBoundingClientRect().width
    const contentLeft = document.querySelector('.workspace-content')!.getBoundingClientRect().left
    toggle().click()
    await settle()
    assert(toggle().getAttribute('aria-expanded') === 'false', 'Collapse state is not announced')
    assert(
      sidebar.getBoundingClientRect().width < wide / 2,
      'Sidebar did not become a compact rail',
    )
    assert(
      document.querySelector('.workspace-content')!.getBoundingClientRect().left < contentLeft,
      'Collapsing navigation did not free content space',
    )
    const nav = document.querySelector('nav[aria-label="Main navigation"]')!
    for (const button of nav.querySelectorAll('button')) {
      assert(button.getAttribute('aria-label'), 'Collapsed navigation lost an accessible name')
      assert(button.getBoundingClientRect().width > 0, 'Collapsed navigation is unreachable')
    }
    const reports = nav.querySelector<HTMLButtonElement>('[aria-label="Reports"]')!
    reports.click()
    for (let i = 0; !document.querySelector('.reports-page') && i < 100; i++) await settle()
    assert(document.querySelector('.reports-page'), 'Reports did not open from the collapsed rail')
    assert(reports.getAttribute('aria-current') === 'page', 'Collapsed navigation lost selection')
    toggle().click()
    await settle()
    assert(toggle().getAttribute('aria-expanded') === 'true', 'Navigation did not expand')
    assert(sidebar.getBoundingClientRect().width === wide, 'Expanded width was not restored')
    return 'Sidebar collapse, content space, accessible navigation and expansion passed'
  } finally {
    if ((toggle().getAttribute('aria-expanded') === 'true') !== originallyExpanded) {
      toggle().click()
      await settle()
    }
  }
}
