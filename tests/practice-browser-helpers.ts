/** Open a preset through the public Practice destination; bundle with browser checks. */
export async function openPracticePreset(mode: 'quiz' | 'exam') {
  const practice = [...document.querySelectorAll<HTMLButtonElement>('nav button')].find(
    (button) => button.textContent?.trim() === 'Practice',
  )
  if (!practice) throw new Error('Practice navigation is missing')
  practice.click()
  const selector = `input[name="practice-preset"][value="${mode}"]`
  const deadline = Date.now() + 8000
  while (!document.querySelector(selector)) {
    if (Date.now() >= deadline) throw new Error('Practice presets did not load')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  document.querySelector<HTMLInputElement>(selector)!.click()
  while (!document.querySelector(`${selector}:checked`)) {
    if (Date.now() >= deadline) throw new Error(`Could not select the ${mode} preset`)
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

/** Wait for the save boundary before interacting with session-wide menu items. */
export async function openPracticeActions() {
  const menu = document.querySelector<HTMLDetailsElement>('.practice-menu')
  if (!menu) throw new Error('Practice actions are missing')
  menu.querySelector<HTMLElement>('summary')!.click()
  const deadline = Date.now() + 8000
  while (!menu.open || menu.querySelector<HTMLButtonElement>('button')?.disabled) {
    if (Date.now() >= deadline) throw new Error('Practice actions did not open after saving')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}
