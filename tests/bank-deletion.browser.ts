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

/** Check the visible result-row alignment with synthetic marked and unmarked completed quizzes. */
export async function bankDeletionHistoryLayoutCheck(): Promise<string> {
  const practice = document.querySelector<HTMLButtonElement>('nav button[aria-label="Practice"]')
  if (!practice) {
    throw new Error('Practice navigation is missing.')
  }
  practice.click()
  const deadline = Date.now() + 5000
  while (!document.querySelector('.completed-results .deleted-bank-badge')) {
    if (Date.now() >= deadline) {
      throw new Error(
        'Requires a completed quiz from a deleted bank in the selected certification.',
      )
    }
    await new Promise((resolve) => window.setTimeout(resolve, 10))
  }
  const rows = [...document.querySelectorAll<HTMLElement>('.completed-results [data-result-id]')]
  for (const row of rows) {
    const date = row.querySelector('time')!.getClientRects()[0]!
    const dot = row.querySelector('.result-indicator')!.getBoundingClientRect()
    if (Math.abs(dot.top + dot.height / 2 - (date.top + date.height / 2)) > 1) {
      throw new Error('The result dot must align with the first line of result text.')
    }
    const badge = row.querySelector('.deleted-bank-badge')?.getBoundingClientRect()
    if (badge) {
      if (
        innerWidth >= 1000 &&
        Math.abs(badge.top + badge.height / 2 - (date.top + date.height / 2)) > 1
      ) {
        throw new Error(
          'The deleted-question badge must be vertically centered with the result text.',
        )
      }
      if (badge.top > date.bottom && Math.abs(badge.left - date.left) > 1) {
        throw new Error('A wrapped badge must align with the result text, rather than the dot.')
      }
    }
  }
  if (document.documentElement.scrollWidth > innerWidth + 1) {
    throw new Error('Completed results must fit without horizontal scrolling.')
  }
  return `Completed result indicators align at ${innerWidth}px without horizontal scrolling.`
}
