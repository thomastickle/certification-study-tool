/** Browser-only score regression; requires the three documented synthetic score attempts. */
export async function scoreReportsTest(): Promise<string> {
  /** Waits for React to render the expected observable report state. */
  async function waitFor(check: () => boolean, message: string) {
    const deadline = Date.now() + 5000
    while (!check()) {
      if (Date.now() >= deadline) {
        throw new Error(message)
      }
      await new Promise((resolve) => window.setTimeout(resolve, 10))
    }
  }

  /** Uses exact button text so chart and mode controls cannot be confused. */
  async function click(text: string) {
    const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
      (item) => item.textContent?.trim() === text,
    )
    if (!button) {
      throw new Error(`Missing button: ${text}`)
    }
    button.click()
    await new Promise((resolve) => window.setTimeout(resolve, 0))
  }

  /** Checks a report score beside its label, rather than any unrelated percentage. */
  async function summary(value: string) {
    await waitFor(
      () =>
        [...document.querySelectorAll('.report-stats > div')].some(
          (item) =>
            item.querySelector('.stat-label')?.textContent?.includes('Score') &&
            item.querySelector('strong')?.textContent === value,
        ),
      `Expected headline Score ${value}`,
    )
  }

  await click('Reports')
  await summary('57%') // 60 correct / 105 appearances, not an average of attempt scores.
  await click('Quizzes')
  await summary('20%') // 8 / 40 including the all-skipped attempt.
  const range = [...document.querySelectorAll<HTMLSelectElement>('select')].find((select) =>
    select.closest('label')?.textContent?.includes('Time range'),
  )!
  range.value = '7'
  range.dispatchEvent(new Event('change', { bubbles: true }))
  await summary('40%')
  const stats = document.querySelector('.report-stats')!.textContent!
  if (stats.includes('Accuracy') || !stats.includes('0 / 1 attempts')) {
    throw new Error('Headlines must use score and keep the eight-of-twenty attempt below target.')
  }
  const domains = [...document.querySelectorAll('.domain-grid .domain-card')]
  if (
    !domains[0]?.textContent?.includes('80%') ||
    !domains[1]?.textContent?.includes('0%') ||
    !domains[2]?.textContent?.includes('—')
  ) {
    throw new Error('Domain scores must distinguish 8/10, all skipped, and no questions.')
  }
  if (!document.querySelector('.focus-card')?.textContent?.includes('0%')) {
    throw new Error('Focus suggestion must use the lowest measured score, including skips.')
  }
  await click('Score')
  await waitFor(
    () => document.querySelector('.chart-caption')?.textContent?.includes('Daily score') === true,
    'Daily score chart was not selected.',
  )
  if (
    document
      .querySelector('.progress-chart circle title')
      ?.textContent?.includes('8 correct / 20 questions') !== true ||
    document.querySelector('.progress-chart circle')?.getAttribute('cy') !== '122' ||
    !document.querySelector('.chart-target')?.textContent?.includes('80% practice target')
  ) {
    throw new Error(
      'Daily chart must plot 40% against the score target with the total denominator.',
    )
  }
  const chartData = document.querySelector<HTMLDetailsElement>('.chart-data')!
  chartData.open = true
  if (!chartData.textContent?.includes('40%') || chartData.textContent?.includes('Accuracy')) {
    throw new Error('Chart data must show daily score.')
  }
  await click('Study details')
  await waitFor(() => document.querySelector('.report-table') !== null, 'Study details missing.')
  const details = document.querySelector('.report-table')!.textContent!
  if (
    !details.includes('Accuracy on answered questions') ||
    !details.includes('Answered') ||
    !details.includes('Skipped') ||
    !details.includes('100%')
  ) {
    throw new Error('Detailed accuracy needs the exact label and nearby answered/skipped counts.')
  }
  document
    .querySelector<HTMLButtonElement>('#report-attempt-00000000-0000-4000-8000-000000000001')!
    .click()
  await waitFor(
    () => document.querySelector('.attempt-summary') !== null,
    'Attempt report missing.',
  )
  const attempt = document.querySelector('.attempt-summary')!.textContent!
  if (
    !attempt.includes('40%') ||
    !attempt.includes('Accuracy on answered questions: 100%') ||
    !attempt.includes('8 answered') ||
    !attempt.includes('12 skipped')
  ) {
    throw new Error('Individual report must keep score primary and accuracy in labeled details.')
  }
  await click('← Back to reports')
  await click('Exams')
  await summary('80%')
  if (!document.querySelector('.report-stats')?.textContent?.includes('1 / 1 attempts')) {
    throw new Error('Exactly 80% must meet the practice target.')
  }
  document
    .querySelector<HTMLButtonElement>('#report-attempt-00000000-0000-4000-8000-000000000002')!
    .click()
  await waitFor(() => document.querySelector('.attempt-summary') !== null, 'Exam report missing.')
  if (!document.querySelector('.attempt-summary')?.textContent?.includes('80%')) {
    throw new Error('Exam individual score must agree with the dashboard.')
  }
  await click('← Back to reports')
  await click('Quizzes')
  await summary('40%')
  const currentRange = document.querySelector<HTMLSelectElement>('select:not([aria-label])')!
  currentRange.value = 'all'
  currentRange.dispatchEvent(new Event('change', { bubbles: true }))
  await summary('20%')
  document
    .querySelector<HTMLButtonElement>('#report-attempt-00000000-0000-4000-8000-000000000003')!
    .click()
  await waitFor(
    () => document.querySelector('.attempt-summary') !== null,
    'Skipped report missing.',
  )
  const skipped = document.querySelector('.attempt-summary')!.textContent!
  if (
    !skipped.includes('0%') ||
    !skipped.includes('Accuracy on answered questions: —') ||
    !skipped.includes('0 answered') ||
    !skipped.includes('20 skipped')
  ) {
    throw new Error('All skipped must show zero score and unmeasured answered accuracy.')
  }
  await click('← Back to reports')
  for (const [mode, expectedScore, correct, total] of [
    ['Quiz', '40%', 8, 20],
    ['Exam', '80%', 52, 65],
  ] as const) {
    await click(mode)
    await waitFor(
      () => document.querySelector('.history-list') !== null,
      'Practice history missing.',
    )
    const row = [...document.querySelectorAll('.history-list li')].find((item) =>
      item.textContent?.includes(`${correct}/${total}`),
    )!
    row.querySelector<HTMLButtonElement>('button')!.click()
    await waitFor(
      () => document.querySelector('.result-score') !== null,
      'Practice result missing.',
    )
    const result = document.querySelector('.result-score')!.textContent!
    if (
      !result.includes(`Score: ${expectedScore}`) ||
      !result.includes(mode === 'Exam' ? 'Pass' : 'Fail')
    ) {
      throw new Error(`${mode} result score and target must agree with reports.`)
    }
    const detail = document.querySelector('.result-score + .quiz-panel')!.textContent!
    if (
      !detail.includes('Accuracy on answered questions: 100%') ||
      !detail.includes(`${correct} answered`) ||
      !detail.includes(`${total - correct} skipped`)
    ) {
      throw new Error(`${mode} result needs labeled detailed accuracy and answer counts.`)
    }
  }
  await click('Reports')
  return 'Score-first master, mode/date filters, chart, domains, detailed accuracy and individual quiz/exam reports passed.'
}

/** Completion summaries keep score, question counts and outcome together without extra target copy. */
export async function compactCompletionSummaryTest(zeroSkipAttemptId?: string): Promise<string> {
  /** Waits for the selected synthetic attempt to render. */
  async function until(check: () => boolean, message: string) {
    const deadline = Date.now() + 5000
    while (!check()) {
      if (Date.now() >= deadline) {
        throw new Error(message)
      }
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
  }

  const cases = [
    ['00000000-0000-4000-8000-000000000001', 'Score: 40%', '8 of 20', 'Fail', '12 skipped'],
    ['00000000-0000-4000-8000-000000000002', 'Score: 80%', '52 of 65', 'Pass', '13 skipped'],
    ['00000000-0000-4000-8000-000000000003', 'Score: 0%', '0 of 20', 'Fail', '20 skipped'],
  ]
  if (zeroSkipAttemptId) {
    cases.push([zeroSkipAttemptId, 'Score: 100%', '20 of 20', 'Pass', ''])
  }
  for (const [id, score, count, outcome, skipped] of cases) {
    const home = [...document.querySelectorAll<HTMLButtonElement>('nav button')].find(
      (button) => button.textContent?.trim() === 'Home',
    )!
    home.click()
    await until(() => !!document.querySelector('.home-page'), 'Home did not open')
    const practice = [...document.querySelectorAll<HTMLButtonElement>('nav button')].find(
      (button) => button.textContent?.trim() === 'Practice',
    )!
    practice.click()
    await until(() => !!document.querySelector(`a[href="#result-${id}"]`), 'History missing')
    document.querySelector<HTMLAnchorElement>(`a[href="#result-${id}"]`)!.click()
    await until(() => !!document.querySelector('.result-score'), 'Completion card missing')
    const expected = [outcome, score, count, skipped]
    const actual = [
      '.result-summary-outcome',
      '.result-summary-score',
      '.result-summary-count',
      '.result-summary-skipped',
    ].map(
      (selector) =>
        document.querySelector(selector)?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
    )
    if (
      !document
        .querySelector('.result-score-value')
        ?.firstElementChild?.classList.contains('result-summary-outcome')
    ) {
      throw new Error('Outcome must lead the summary row')
    }
    if (expected.some((value, index) => actual[index] !== value)) {
      throw new Error(
        `Expected score, count and outcome ${expected.join(' / ')}, got ${actual.join(' / ')}`,
      )
    }
    if (document.querySelector('.result-score')!.textContent!.includes('practice target')) {
      throw new Error('Completion card still has practice-target explanation')
    }
    const back = [...document.querySelectorAll<HTMLButtonElement>('.result-score button')].find(
      (button) => button.textContent?.includes('Back to practice history'),
    )!
    back.click()
    await until(() => !document.querySelector('.result-score'), 'History did not reopen')
  }
  return 'Compact quiz/exam summaries preserve correct score, counts, and pass/fail, including all-skipped.'
}
