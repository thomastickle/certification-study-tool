/** Navigate to the public Settings destination before interacting with its controls. */
async function openSettings() {
  document.querySelector<HTMLButtonElement>('.settings-trigger')!.click()
  await new Promise((resolve) => setTimeout(resolve, 100))
  if (!document.querySelector('main.settings-page')) throw new Error('Settings page did not open')
}

/** Exercise the mounted control and real CSS; use a disposable study library. */
export async function themeBrowserTest() {
  /** Change the public control and let React commit its effect. */
  async function choose(value: string) {
    await openSettings()
    const select = document.querySelector<HTMLSelectElement>('.theme-control select')!
    select.value = value
    select.dispatchEvent(new Event('change', { bubbles: true }))
    await new Promise((resolve) => setTimeout(resolve, 40))
  }

  /** Report the failed visible behavior without tying checks to CSS declarations. */
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message)
  }

  const canvas = document.querySelector('.workspace-content')!
  await choose('light')
  const light = getComputedStyle(canvas).backgroundColor
  assert(localStorage.getItem('study-theme') === 'light', 'Light choice was not saved')
  await choose('dark')
  const dark = getComputedStyle(canvas).backgroundColor
  assert(light !== dark, 'Theme control did not change the rendered canvas')
  assert(localStorage.getItem('study-theme') === 'dark', 'Dark choice was not saved')
  for (const label of ['Home', 'Practice', 'Due Review', 'Certifications', 'Importer', 'Reports']) {
    document.querySelector<HTMLButtonElement>(`nav button[aria-label="${label}"]`)!.click()
    await new Promise((resolve) => setTimeout(resolve, 150))
    assert(getComputedStyle(canvas).backgroundColor === dark, `${label} lost the dark canvas`)
    assert(document.documentElement.scrollWidth <= innerWidth, `${label} overflows the viewport`)
  }
  await choose('system')
  assert(localStorage.getItem('study-theme') === null, 'System did not clear the override')
  const expected = matchMedia('(prefers-color-scheme: dark)').matches ? dark : light
  assert(
    getComputedStyle(canvas).backgroundColor === expected,
    'System does not follow browser preference',
  )
  return { light, dark, system: expected, destinations: 7, width: innerWidth }
}

/** Check every palette/appearance pairing, including Reports after leaving Settings. */
export async function paletteBrowserTest() {
  /** Calculate WCAG contrast from the actual rendered foreground and fill. */
  function luminance(color: string) {
    const channels = color
      .match(/[\d.]+/g)!
      .slice(0, 3)
      .map(Number)
    return channels.reduce((sum, channel, index) => {
      const value = channel / 255
      const linear = value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
      return sum + linear * [0.2126, 0.7152, 0.0722][index]!
    }, 0)
  }

  const results: { palette: string; appearance: string; canvas: string }[] = []
  for (const value of ['blue', 'forest', 'violet']) {
    for (const mode of ['light', 'dark']) {
      await openSettings()
      const appearance = document.querySelector<HTMLSelectElement>('.theme-control select')
      const palette = document.querySelector<HTMLInputElement>(
        `input[name="palette"][value="${value}"]`,
      )
      if (!appearance || !palette) throw new Error('Missing appearance controls')
      palette.click()
      appearance.value = mode
      appearance.dispatchEvent(new Event('change', { bubbles: true }))
      await new Promise((resolve) => setTimeout(resolve, 50))
      if (document.documentElement.dataset.palette !== value)
        throw new Error('Palette did not apply')
      if (localStorage.getItem('study-palette') !== (value === 'blue' ? null : value))
        throw new Error('Palette did not persist')
      if (document.documentElement.scrollWidth > innerWidth)
        throw new Error('Appearance controls overflow')
      document.querySelector<HTMLButtonElement>('nav button[aria-label="Reports"]')!.click()
      await new Promise((resolve) => setTimeout(resolve, 150))
      const selected = document.querySelector('.report-mode-switch button[aria-pressed="true"]')
      if (!selected) throw new Error('Missing selected Reports mode')
      const style = getComputedStyle(selected)
      const foreground = luminance(style.color)
      const background = luminance(style.backgroundColor)
      const ratio =
        (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05)
      if (ratio < 4.5)
        throw new Error(`${value}/${mode}: selected Reports mode contrast is ${ratio.toFixed(2)}:1`)
      results.push({
        palette: value,
        appearance: mode,
        canvas: getComputedStyle(document.querySelector('.workspace-content')!).backgroundColor,
      })
    }
  }
  if (new Set(results.map((result) => result.canvas)).size !== 6)
    throw new Error('Palette/appearance combinations must have distinct canvases')
  return results
}
