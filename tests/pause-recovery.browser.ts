import { workspaceFetch } from './browser-api.ts'

import { openPracticePreset } from './practice-browser-helpers.ts'

/** Browser-only checks split around an actual restart of the disposable app server. */
export async function preparePauseRecovery(mode: 'quiz' | 'exam') {
  function click(text: string) {
    const button = [...document.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === text,
    )
    if (!button || button.disabled) {
      throw new Error(`Missing enabled button: ${text}`)
    }
    button.click()
  }

  async function until(predicate: () => boolean) {
    const end = Date.now() + 5000
    while (!predicate()) {
      if (Date.now() > end) {
        throw new Error('Recovery setup timed out')
      }
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
  }

  click('Reports')
  await until(() => !!document.querySelector('.reports-page'))
  await openPracticePreset(mode)
  const start = `Start ${mode === 'exam' ? 65 : 20}-question ${mode}`
  await until(() =>
    [...document.querySelectorAll('button')].some(
      (b) => b.textContent?.trim() === start && !b.disabled,
    ),
  )
  click(start)
  await until(() => !!document.querySelector('.quiz-question'))
  click('Reports')
  await until(() => !!document.querySelector('.reports-page'))
  const paused = await (await workspaceFetch(`/api/quizzes/current?mode=${mode}`)).json()
  if (paused.status !== 'paused') {
    throw new Error('Attempt was not suspended')
  }
  return {
    mode,
    id: paused.id as string,
    remaining: paused.deadline - paused.pausedAt,
    serverNow: paused.serverNow as number,
  }
}

/** Run after stopping/restarting the same synthetic database server and reloading the page. */
export async function verifyPauseRecovery(saved: {
  mode: 'quiz' | 'exam'
  id: string
  remaining: number
  serverNow: number
}) {
  function click(text: string) {
    const button = [...document.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === text,
    )
    if (!button || button.disabled) {
      throw new Error(`Missing enabled button: ${text}`)
    }
    button.click()
  }

  async function until(predicate: () => boolean) {
    const end = Date.now() + 8000
    while (!predicate()) {
      if (Date.now() > end) {
        throw new Error('Recovery verification timed out')
      }
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
  }

  await openPracticePreset(saved.mode)
  await until(() => !!document.querySelector('.recovery-panel'))
  click(`Continue ${saved.mode}`)
  await until(() => !!document.querySelector('.paused-panel'))
  const paused = await (await workspaceFetch(`/api/quizzes/${saved.id}`)).json()
  if (paused.status !== 'paused' || paused.deadline - paused.pausedAt !== saved.remaining) {
    throw new Error('Restart changed frozen remaining time')
  }
  if (
    paused.pauseHistory.intervals.length !== 1 ||
    paused.pauseHistory.intervals[0].endedAt !== null
  ) {
    throw new Error('Restart lost ongoing interval')
  }
  const observed = document.querySelector('.attempt-timing')!.textContent!
  await until(() => document.querySelector('.attempt-timing')?.textContent !== observed)
  if (!document.querySelector('.attempt-timing')?.textContent?.includes('Ongoing')) {
    throw new Error('Ongoing duration was not refreshed')
  }
  if (paused.serverNow < saved.serverNow) {
    throw new Error('Server observation did not advance')
  }
  click(`Resume ${saved.mode}`)
  await until(() => !!document.querySelector('.quiz-question'))
  const resumed = await (await workspaceFetch(`/api/quizzes/${saved.id}`)).json()
  if (
    resumed.status !== 'active' ||
    resumed.deadline - resumed.serverNow > saved.remaining ||
    resumed.pauseHistory.intervals[0].endedAt === null
  ) {
    throw new Error('Explicit resume lost time or history')
  }
  // Finish through the normal HTTP boundary, then refresh via in-app navigation.
  await workspaceFetch(`/api/quizzes/${saved.id}/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ answers: resumed.questions }),
  })
  click('Reports')
  await until(() => !!document.querySelector('.reports-page'))
  await until(() => !!document.getElementById(`report-attempt-${saved.id}`))
  const row = document.getElementById(`report-attempt-${saved.id}`)!
  if (
    !row.textContent?.includes('Active study:') ||
    !row.textContent.includes('Elapsed:') ||
    !row.textContent.includes('Pauses: 1')
  ) {
    throw new Error('Journal timing labels missing')
  }
  ;(row as HTMLButtonElement).click()
  await until(() => !!document.querySelector('.attempt-timing'))
  // The compact UI shows totals; the export below retains individual pause evidence.
  const metrics = new Map(
    [...document.querySelectorAll('.attempt-timing dl > div')].map((item) => [
      item.querySelector('dt')?.textContent,
      item.querySelector('dd')?.textContent,
    ]),
  )
  if (
    metrics.get('Pauses') !== '1' ||
    ['Total time', 'Time in test', 'Pause time'].some(
      (label) => !metrics.get(label) || metrics.get(label) === '—',
    )
  ) {
    throw new Error('Completed timing totals missing')
  }
  const originalCreate = URL.createObjectURL
  let exported: Blob | undefined

  const stopDownload = (event: MouseEvent) => {
    if (event.target instanceof HTMLAnchorElement && event.target.download) {
      event.preventDefault()
    }
  }

  document.addEventListener('click', stopDownload, true)
  URL.createObjectURL = (blob) => {
    if (blob instanceof Blob) {
      exported = blob
    }
    return originalCreate(blob)
  }
  try {
    click('↓ Export attempt')
    await until(() => !!exported)
    const markdown = await exported!.text()
    if (
      !markdown.includes('Active study:') ||
      !markdown.includes('Elapsed:') ||
      !markdown.includes('Pause 1: navigation')
    ) {
      throw new Error('Attempt export timing missing')
    }
    exported = undefined
    click('← Back to reports')
    await until(() => !document.querySelector('.attempt-timing'))
    click('↓ Export report')
    await until(() => !!exported)
    if (!(await exported!.text()).includes('Total paused:')) {
      throw new Error('Master export timing missing')
    }
    return `${saved.mode}: server restart, ongoing server observation, resume, journal, detail and exports passed`
  } finally {
    URL.createObjectURL = originalCreate
    document.removeEventListener('click', stopDownload, true)
  }
}
