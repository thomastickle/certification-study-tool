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
  assert(page.querySelectorAll('select').length === 1, 'Appearance must contain the Theme selector')
  assert(
    page.querySelectorAll('input[name="palette"]').length === 3,
    'Appearance must contain palette swatches',
  )
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

/** Select every visual palette preview using its public radio control. */
export async function paletteSwatchesBrowserTest() {
  document.querySelector<HTMLButtonElement>('.settings-trigger')!.click()
  await new Promise((resolve) => setTimeout(resolve, 100))
  const radios = [...document.querySelectorAll<HTMLInputElement>('input[name="palette"]')]
  if (radios.length !== 3) throw new Error('Palette must offer three native radio swatches')
  const initial = radios.find((radio) => radio.checked)!
  const previews = []
  try {
    for (const radio of radios) {
      radio.click()
      await new Promise((resolve) => setTimeout(resolve, 40))
      if (!radio.checked || radios.filter((item) => item.checked).length !== 1) {
        throw new Error('Palette must have exactly one selected swatch')
      }
      if (document.documentElement.dataset.palette !== radio.value)
        throw new Error('Swatch did not apply palette')
      const expected = radio.value === 'blue' ? null : radio.value
      if (localStorage.getItem('study-palette') !== expected)
        throw new Error('Swatch did not save palette')
      const preview = radio.parentElement!.querySelector<HTMLElement>('.palette-preview')!
      if (
        !preview ||
        !radio.labels?.[0]?.textContent?.includes(
          radio.value[0]!.toUpperCase() + radio.value.slice(1),
        )
      ) {
        throw new Error('Palette swatch needs a visual preview and a visible name')
      }
      previews.push(getComputedStyle(preview).backgroundImage)
    }
    if (new Set(previews).size !== 3) throw new Error('Palette previews must show their own colors')
    if (document.documentElement.scrollWidth > innerWidth)
      throw new Error('Swatches overflow the viewport')
    return { swatches: 3, selection: 'exclusive, applied, persisted, labeled', width: innerWidth }
  } finally {
    initial.click()
  }
}
