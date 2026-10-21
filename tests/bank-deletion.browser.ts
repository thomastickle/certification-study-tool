/** Exercise ReportsPage with synthetic CLF history from deleted banks and no Due Reviews. */
export async function bankDeletionReportCheck(): Promise<string> {
  /** Wait for the rendered page state rather than a fixed request delay. */
  async function waitFor(check: () => boolean, message: string) {
    const deadline = Date.now() + 5000
    while (!check()) {
      if (Date.now() >= deadline) {
        throw new Error(message)
      }
      await new Promise((resolve) => window.setTimeout(resolve, 10))
    }
  }

  /** Select the actual page controls so this covers loading and empty-state gates. */
  async function click(text: string) {
    const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
      (element) => element.textContent?.trim() === text,
    )
    if (!button) {
      throw new Error(`Missing control: ${text}`)
    }
    button.click()
    await new Promise((resolve) => window.setTimeout(resolve, 0))
  }

  const response = await fetch('/api/reports?mode=review')
  if (!response.ok) {
    throw new Error('Could not read the synthetic report fixture.')
  }
  const report = (await response.json()) as {
    attempts: unknown[]
    deletedBankLifetimeAttemptCount: number
  }
  if (report.attempts.length || !report.deletedBankLifetimeAttemptCount) {
    throw new Error('Requires deleted-bank completed history and an empty Due Reviews filter.')
  }
  await click('Reports')
  await click('Master report')
  await waitFor(() => !!document.querySelector('.report-stats'), 'Master report did not load.')
  await click('Due Reviews')
  await waitFor(() => !!document.querySelector('.report-empty'), 'Empty report did not load.')
  const notice = [
    ...document.querySelectorAll<HTMLElement>('.reports-page .deleted-bank-notice'),
  ].find((element) => element.innerText.includes('Lifetime mastery includes'))
  if (!notice || notice.closest('[hidden]') || !notice.getClientRects().length) {
    throw new Error(
      'ReportsPage must show the lifetime deleted-bank warning even when the filter has no attempts.',
    )
  }
  if (!notice.innerText.includes(String(report.deletedBankLifetimeAttemptCount))) {
    throw new Error('Lifetime warning must match the scoped report evidence.')
  }
  if (document.querySelector('.report-stats')) {
    throw new Error('An empty filter must not show measured summary statistics.')
  }
  await click('Show all practice')
  await waitFor(() => !!document.querySelector('.report-stats'), 'Master report did not return.')
  if (
    [...document.querySelectorAll('.deleted-bank-notice')].some((element) =>
      element.textContent?.includes('including attempts outside these filters'),
    )
  ) {
    throw new Error(
      'All-time Master report must not claim affected attempts exist outside its filters.',
    )
  }
  return 'ReportsPage retains the lifetime warning in empty filters and restores the populated report.'
}
