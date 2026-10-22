/** Exercise Settings as a full workspace destination, using a disposable library. */
export async function settingsBrowserTest() {
  /** Fail on the visible behavior that a user would encounter. */
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message)
  }

  const trigger = document.querySelector<HTMLButtonElement>('aside button[aria-label="Settings"]')
  assert(trigger, 'Sidebar Settings button is missing')
  trigger.click()
  await new Promise((resolve) => setTimeout(resolve, 100))
  const page = document.querySelector<HTMLElement>('main.settings-page')
  assert(page, 'Settings must open as a full workspace page')
  assert(trigger.getAttribute('aria-current') === 'page', 'Settings destination is not announced')
  assert(!document.querySelector('dialog.settings-dialog'), 'Settings still uses a modal')
  assert(page.querySelector('h1')?.textContent === 'Settings', 'Settings page has no heading')
  assert(page.querySelectorAll('select').length === 2, 'Appearance must contain Theme and Palette')
  assert(
    !document.querySelector('header .appearance-controls'),
    'Appearance controls remain in header',
  )
  assert(document.documentElement.scrollWidth <= innerWidth, 'Settings page overflows')
  document.querySelector<HTMLButtonElement>('nav button[aria-label="Home"]')!.click()
  await new Promise((resolve) => setTimeout(resolve, 100))
  assert(!document.querySelector('.settings-page'), 'Navigating away did not leave Settings')
  trigger.click()
  await new Promise((resolve) => setTimeout(resolve, 100))
  assert(document.querySelector('.settings-page'), 'Settings cannot be revisited')
  return { width: innerWidth, settings: 'page, active destination, appearance, navigation passed' }
}

/** A session-only choice must survive leaving and revisiting Settings when storage is blocked. */
export async function settingsSessionPreferenceTest() {
  const original = Storage.prototype.setItem
  try {
    Storage.prototype.setItem = () => {
      throw new Error('Storage blocked for this browser test')
    }
    document.querySelector<HTMLButtonElement>('.settings-trigger')!.click()
    await new Promise((resolve) => setTimeout(resolve, 100))
    const select = document.querySelector<HTMLSelectElement>('.theme-control select')!
    select.value = 'light'
    select.dispatchEvent(new Event('change', { bubbles: true }))
    await new Promise((resolve) => setTimeout(resolve, 40))
    document.querySelector<HTMLButtonElement>('nav button[aria-label="Home"]')!.click()
    await new Promise((resolve) => setTimeout(resolve, 100))
    document.querySelector<HTMLButtonElement>('.settings-trigger')!.click()
    await new Promise((resolve) => setTimeout(resolve, 100))
    if (document.querySelector<HTMLSelectElement>('.theme-control select')!.value !== 'light') {
      throw new Error('Navigating reset a session-only preference')
    }
    if (document.documentElement.dataset.theme !== 'light')
      throw new Error('Session appearance was lost')
    return 'Session-only appearance survives navigation when persistence is blocked'
  } finally {
    Storage.prototype.setItem = original
  }
}
