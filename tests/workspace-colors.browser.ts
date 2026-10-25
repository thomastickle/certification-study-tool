/** Verify the shared blue workspace and neutral reading surfaces on a synthetic library. */
export async function workspaceColorsTest() {
  /** Fail with the affected visual contract rather than a CSS implementation detail. */
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message)
  }

  /** Wait for each destination's data-backed content to render. */
  async function until(selector: string) {
    const deadline = Date.now() + 8000
    while (!document.querySelector(selector)) {
      assert(Date.now() < deadline, `Missing ${selector}`)
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
  }

  const destinations = [
    ['Home', '.provider-card'],
    ['Practice', '.practice-setup'],
    ['Reports', '.report-panel, .report-empty'],
    ['Certifications', '.management-card'],
    ['Library', '.source-panel'],
  ]
  let canvas = ''
  for (const [label, selector] of destinations) {
    const button = [...document.querySelectorAll<HTMLButtonElement>('nav button')].find(
      (item) => item.textContent?.trim() === label,
    )
    assert(button, `Missing ${label} navigation`)
    button.click()
    await until(selector!)
    const workspace = document.querySelector('.workspace-content')!
    const background = getComputedStyle(workspace).backgroundColor
    const channels = background.match(/[\d.]+/g)!.map(Number)
    assert(
      channels.length === 3 && channels[0]! >= 220 && channels[2]! > channels[0]! + 8,
      `${label}: workspace must have an opaque, subtle blue canvas`,
    )
    if (canvas) assert(background === canvas, `${label}: workspace color differs`)
    canvas = background
    assert(
      document.documentElement.scrollWidth <= innerWidth,
      `${label}: workspace overflows horizontally`,
    )
  }
  return 'All five destinations share a subtle blue canvas without horizontal overflow'
}
