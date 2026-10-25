/** Exercise the mounted session gate with a deferred old request and a synthetic replacement login.
 * Uses a disposable signed-in library; reload afterward to restore the real account's UI.
 */
export async function workspaceRaceBrowserTest() {
  const original = window.fetch
  const account = document.querySelector<HTMLElement>('[data-study-account]')?.dataset.studyAccount
  if (!account) throw new Error('Sign in to a disposable workspace before running this check.')
  const replacement = 'synthetic-browser-replacement'
  let switched = false
  let finishOld: ((response: Response) => void) | undefined
  let settled = false
  let sessionChecks = 0

  async function until(condition: () => boolean, message: string) {
    const deadline = Date.now() + 8000
    while (!condition()) {
      if (Date.now() >= deadline) throw new Error(message)
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
  }

  window.fetch = async (input, options) => {
    const path = new URL(String(input), location.origin).pathname
    const requestAccount = new Headers(options?.headers).get('X-Study-Account')
    if (path === '/api/session') {
      sessionChecks++
      if (switched) {
        return Response.json({ user: { id: replacement, name: 'Synthetic Replacement' } })
      }
      return Response.json({ user: { id: account, name: 'Original Workspace' } })
    }
    if (requestAccount === replacement) {
      if (path === '/api/sources') return Response.json([])
      if (path === '/api/home') return Response.json({ generatedAt: Date.now(), providers: [] })
      throw new Error('Unexpected replacement-account request during the browser check.')
    }
    if (path === '/api/questions' && requestAccount === account) {
      return new Promise<Response>((resolve) => {
        finishOld = resolve
      }).finally(() => {
        settled = true
      })
    }
    return original(input, options)
  }
  try {
    const importer = [...document.querySelectorAll<HTMLButtonElement>('nav button')].find(
      (button) => button.textContent?.trim() === 'Library',
    )
    if (!importer) throw new Error('Library navigation is missing.')
    importer.click()
    await until(() => !!finishOld, 'The old workspace did not start its library request.')
    window.dispatchEvent(new Event('focus'))
    await until(() => sessionChecks > 0, 'The same-account focus check did not run.')
    // Hidden review tabs may suspend animation frames; timers still let React commit.
    await new Promise((resolve) => setTimeout(resolve, 50))
    if (!document.querySelector('main h1')?.textContent?.includes('Question library')) {
      throw new Error('A same-account focus check remounted the active workspace.')
    }
    switched = true
    window.dispatchEvent(new Event('focus'))
    await until(
      () =>
        document.querySelector<HTMLElement>('[data-study-account]')?.dataset.studyAccount ===
        replacement,
      'The replacement workspace did not mount.',
    )
    finishOld!(
      Response.json({ code: 'workspace_changed', error: 'Old account changed.' }, { status: 409 }),
    )
    await until(() => settled, 'The old response did not settle.')
    await new Promise((resolve) => setTimeout(resolve, 50))
    if (
      document.querySelector<HTMLElement>('[data-study-account]')?.dataset.studyAccount !==
      replacement
    ) {
      throw new Error('The late old-account failure invalidated the replacement workspace.')
    }
    return { sameAccountFocusPreserved: true, obsoleteFailureIgnored: true }
  } finally {
    window.fetch = original
    finishOld?.(Response.json({ items: [], total: 0, page: 1, pageSize: 25 }))
  }
}
