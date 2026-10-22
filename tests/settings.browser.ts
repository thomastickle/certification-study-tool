/** Exercise sidebar Settings without navigating away from the current study page. */
export async function settingsBrowserTest() {
  /** Fail on the visible behavior that a user would encounter. */
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message)
  }

  const trigger = document.querySelector<HTMLButtonElement>('aside button[aria-label="Settings"]')
  assert(trigger, 'Sidebar Settings button is missing')
  assert(
    !document.querySelector('header .appearance-controls'),
    'Appearance controls remain in header',
  )
  const content = document.querySelector('.workspace-content')
  trigger.focus()
  trigger.click()
  const dialog = document.querySelector<HTMLDialogElement>(
    'dialog[aria-labelledby="settings-title"]',
  )
  assert(dialog?.open, 'Settings panel did not open')
  assert(dialog.querySelectorAll('select').length === 2, 'Settings must contain Theme and Palette')
  assert(
    dialog.contains(document.activeElement),
    'Opening Settings must move keyboard focus inside',
  )
  assert(
    document.querySelector('.workspace-content') === content,
    'Settings replaced the current study page',
  )
  dialog.querySelector<HTMLButtonElement>('[aria-label="Close settings"]')!.click()
  assert(!dialog.open, 'Close settings did not dismiss the panel')
  assert(document.activeElement === trigger, 'Closing Settings did not restore focus')
  return { width: innerWidth, settings: 'open, controls, close, focus restoration passed' }
}
