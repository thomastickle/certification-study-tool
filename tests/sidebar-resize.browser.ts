/** Check edge placement, keyboard resizing, limits, and collapse without changing the page. */
export async function sidebarResizeTest() {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message)
  }

  async function settle() {
    await new Promise<void>((resolve) => queueMicrotask(resolve))
  }

  assert(innerWidth > 760, 'Use a desktop viewport for the resize test')
  const separator = document.querySelector<HTMLElement>(
    '[role="separator"][aria-label="Resize navigation"]',
  )
  assert(separator, 'Draggable navigation edge is missing')
  const edge = separator
  const toggle = document.querySelector<HTMLButtonElement>('.sidebar-toggle')!
  const sidebar = document.querySelector<HTMLElement>('.workspace-sidebar')!
  const page = document.querySelector('main')
  const originallyExpanded = toggle.getAttribute('aria-expanded') === 'true'
  const originalWidth = localStorage.getItem('study-sidebar-width')
  const startingWidth = originallyExpanded
    ? sidebar.getBoundingClientRect().width
    : Number(originalWidth ?? (innerWidth <= 1100 ? 184 : 220))

  async function key(value: string, shiftKey = false) {
    edge.dispatchEvent(
      new KeyboardEvent('keydown', { key: value, shiftKey, bubbles: true, cancelable: true }),
    )
    await settle()
  }

  try {
    if (!originallyExpanded) {
      toggle.click()
      await settle()
    }
    if (sidebar.getBoundingClientRect().width === 320) await key('ArrowLeft')
    const initial = sidebar.getBoundingClientRect().width
    const handle = toggle.getBoundingClientRect()
    assert(
      Math.abs((handle.left + handle.right) / 2 - sidebar.getBoundingClientRect().right) < 2,
      'Collapse button must straddle the sidebar edge',
    )
    await key('ArrowRight')
    assert(sidebar.getBoundingClientRect().width > initial, 'Right arrow did not grow navigation')
    await key('End')
    assert(sidebar.getBoundingClientRect().width === 320, 'Expanded width must be bounded')
    await key('Enter')
    assert(sidebar.getBoundingClientRect().width === 72, 'Enter did not collapse navigation')
    toggle.click()
    await settle()
    assert(sidebar.getBoundingClientRect().width === 320, 'Expand did not restore the chosen width')
    await key('Home')
    assert(toggle.getAttribute('aria-expanded') === 'false', 'Home did not collapse navigation')
    assert(document.querySelector('main') === page, 'Resizing remounted the current page')
    assert(
      document.documentElement.scrollWidth <= innerWidth + 1,
      'Resizing caused horizontal overflow',
    )
    return 'Edge collapse, keyboard resize, limits and current page preservation passed'
  } finally {
    await key('End')
    while (Number(edge.getAttribute('aria-valuenow')) > startingWidth && startingWidth > 72) {
      await key('ArrowLeft', Number(edge.getAttribute('aria-valuenow')) - startingWidth >= 10)
    }
    if ((toggle.getAttribute('aria-expanded') === 'true') !== originallyExpanded) toggle.click()
    if (originalWidth === null) localStorage.removeItem('study-sidebar-width')
    else localStorage.setItem('study-sidebar-width', originalWidth)
    await settle()
  }
}
