/** Check Reports at the supplied viewport with both sidebar states and a completed test attempt. */
export async function reportsLayoutTest(): Promise<string> {
  const reports = [...document.querySelectorAll<HTMLButtonElement>('nav button')].find(
    (button) => button.textContent?.trim() === 'Reports',
  )
  if (!reports) {
    throw new Error('Reports navigation is missing.')
  }
  reports.click()
  const deadline = Date.now() + 5000
  while (!document.querySelector('.confidence-panel .outcome-bar')) {
    if (Date.now() >= deadline) {
      throw new Error('The populated report did not load.')
    }
    await new Promise((resolve) => window.setTimeout(resolve, 10))
  }
  const toggle = document.querySelector<HTMLButtonElement>('.sidebar-toggle')
  const canToggle = toggle && getComputedStyle(toggle).display !== 'none'

  function checkLayout() {
    for (const bar of document.querySelectorAll<HTMLElement>('.confidence-panel .outcome-bar')) {
      const row = bar.parentElement!
      const label = row.firstElementChild!.getBoundingClientRect()
      const bounds = bar.getBoundingClientRect()
      if (bounds.top < label.bottom || bounds.width < row.getBoundingClientRect().width - 1) {
        throw new Error('Report confidence bars must sit below their labels at the full row width.')
      }
    }
    if (document.documentElement.scrollWidth > document.documentElement.clientWidth + 1) {
      throw new Error('Reports must fit the viewport without horizontal scrolling.')
    }
    for (const filter of document.querySelectorAll('.report-filter-group select')) {
      const bounds = filter.getBoundingClientRect()
      if (bounds.left < 0 || bounds.right > document.documentElement.clientWidth + 1) {
        throw new Error('Report filters must remain fully visible.')
      }
    }
  }

  checkLayout()
  if (canToggle) {
    toggle.click()
    try {
      await new Promise(requestAnimationFrame)
      checkLayout()
    } finally {
      toggle.click()
      await new Promise(requestAnimationFrame)
    }
  }
  return `Reports bars and filters fit at ${innerWidth}px in every available sidebar state.`
}
