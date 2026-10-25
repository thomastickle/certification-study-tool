/** Run on the Importer page in the collaborative preview. */
export function importerContrastTest() {
  function luminance(color: string) {
    const channels = color
      .match(/[\d.]+/g)!
      .slice(0, 3)
      .map(Number)
    const linear = channels.map((channel) => {
      const value = channel / 255
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
    })
    return linear[0]! * 0.2126 + linear[1]! * 0.7152 + linear[2]! * 0.0722
  }

  const selectors = ['.privacy-note', '.page-heading p', '.result-count', '.file-row']
  for (const selector of selectors) {
    const element = document.querySelector<HTMLElement>(`.library-page ${selector}`)
    if (!element) throw new Error(`Missing importer content: ${selector}`)
    let surface: Element | null = element
    while (surface && getComputedStyle(surface).backgroundColor === 'rgba(0, 0, 0, 0)')
      surface = surface.parentElement
    if (!surface) throw new Error(`Missing background: ${selector}`)
    const text = luminance(getComputedStyle(element).color)
    const background = luminance(getComputedStyle(surface).backgroundColor)
    const ratio = (Math.max(text, background) + 0.05) / (Math.min(text, background) + 0.05)
    if (ratio < 7) throw new Error(`${selector}: ${ratio.toFixed(2)}:1 contrast; expected 7:1`)
  }
  return 'Importer supporting text meets 7:1 contrast'
}
