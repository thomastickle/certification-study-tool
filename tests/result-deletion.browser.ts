/** Run only in a disposable populated app; exercises actual result and recovery controls. */
export async function resultDeletionCheck(lostRestore = false, staleRead = false) {
  const originalFetch = window.fetch
  const originalConfirm = window.confirm
  let confirmations = 0
  let restoreCommitted = false
  let releaseRead: (() => void) | undefined
  let readCaptured = false

  function assert(value: unknown, message: string): asserts value {
    if (!value) throw new Error(message)
  }

  async function until(predicate: () => boolean, message: string) {
    const deadline = Date.now() + 5000
    while (!predicate()) {
      assert(Date.now() < deadline, message)
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
  }

  function click(label: string) {
    const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
      (item) =>
        (item.getAttribute('aria-label') ?? item.textContent?.trim()) === label && !item.disabled,
    )
    assert(button, `Missing enabled ${label}`)
    button.click()
  }

  window.confirm = () => {
    confirmations++
    return false
  }
  try {
    click('Practice')
    await until(
      () => !!document.querySelector('.completed-results a'),
      'Setup results did not load',
    )
    const first = document.querySelector<HTMLAnchorElement>('.completed-results a')!
    const attemptId = first.closest('li')!.dataset.resultId!

    const row = () => document.querySelector<HTMLElement>(`[data-result-id="${attemptId}"]`)!

    const remove = row().querySelector<HTMLButtonElement>('button[aria-label="Delete result"]')!
    assert(remove.querySelector('svg'), 'Delete icon missing')
    remove.click()
    await until(
      () => row()?.classList.contains('pending-deletion'),
      'Pending result did not stay in history',
    )
    assert(row().textContent?.includes('Will be deleted on'), 'Deletion deadline missing')
    assert(row().querySelector('time[datetime]'), 'Deletion date missing')
    assert(row().querySelector('button[aria-label="Undo deletion"] svg'), 'Undo icon missing')
    assert(!row().querySelector('a'), 'Pending result still opens counted result')
    assert(
      !document.body.innerText.includes('Recently deleted results'),
      'Separate deleted section remains',
    )
    const deletedReport = await (await originalFetch('/api/reports')).json()
    assert(
      !deletedReport.attempts.some((item: { id: string }) => item.id === attemptId),
      'Deleted attempt still counted',
    )
    if (staleRead) {
      const delayed = new Promise<void>((resolve) => {
        releaseRead = resolve
      })
      window.fetch = async (input, init) => {
        const response = await originalFetch(input, init)
        if (String(input).startsWith('/api/quizzes/deleted?') && !readCaptured) {
          readCaptured = true
          await delayed
        }
        return response
      }
      click('Refresh results')
      await until(() => readCaptured, 'Stale read was not captured')
    }
    if (lostRestore) {
      window.fetch = async (input, init) => {
        const response = await originalFetch(input, init)
        if (String(input) === `/api/quizzes/${attemptId}/restore` && response.ok) {
          restoreCommitted = true
          throw new Error('Synthetic lost restore response')
        }
        return response
      }
    }
    row().querySelector<HTMLButtonElement>('button[aria-label="Undo deletion"]')!.click()
    await until(() => !!row()?.querySelector('a'), 'Restored result missing from history')
    assert(
      !row().classList.contains('pending-deletion'),
      'Restored result remains marked for deletion',
    )
    if (staleRead) {
      releaseRead!()
      await new Promise((resolve) => setTimeout(resolve, 100))
      assert(!!row().querySelector('a'), 'Stale read reinserted pending state')
    }
    const restoredReport = await (await originalFetch('/api/reports')).json()
    assert(
      restoredReport.attempts.some((item: { id: string }) => item.id === attemptId),
      'Restored result missing from reports',
    )
    assert(!lostRestore || restoreCommitted, 'Lost response was not exercised')
    assert(confirmations === 0, 'Deletion requested confirmation')
    assert(
      !document.body.innerText.includes('Delete permanently'),
      'Unexpected permanent-delete button',
    )
    return { lostRestore, staleRead, restored: attemptId, confirmations }
  } finally {
    releaseRead?.()
    window.fetch = originalFetch
    window.confirm = originalConfirm
  }
}

/** Setup history exposes result text as a link and a separate deletion action. */
export async function setupResultActionsCheck() {
  const practice = [...document.querySelectorAll<HTMLButtonElement>('nav button')].find(
    (button) => button.textContent?.trim() === 'Practice',
  )!
  practice.click()

  async function until(predicate: () => boolean, message: string) {
    const deadline = Date.now() + 5000
    while (!predicate()) {
      if (Date.now() >= deadline) throw new Error(message)
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
  }

  await until(() => !!document.querySelector('.completed-results a'), 'History did not load')
  const link = document.querySelector<HTMLAnchorElement>('.completed-results a')
  if (!link) throw new Error('Result date and score are not a review link')
  const label = link.textContent
  const id = link.closest('li')!.dataset.resultId!
  const row = link.closest('li')!
  const remove = row.querySelector<HTMLButtonElement>('button[aria-label="Delete result"]')
  if (!remove) throw new Error('Setup row has no delete icon')
  remove.click()
  await until(() => !!document.querySelector('button[aria-label="Undo deletion"]'), 'Undo missing')
  await until(
    () =>
      ![...document.querySelectorAll('.completed-results a')].some(
        (item) => item.textContent === label,
      ),
    'Deleted result remains in setup',
  )
  const pending = document.querySelector<HTMLElement>(`[data-result-id="${id}"]`)!
  if (!pending.textContent?.includes(label!) || !pending.querySelector('time'))
    throw new Error('Pending row lost its result or deletion date')
  pending.querySelector<HTMLButtonElement>('button[aria-label="Undo deletion"]')!.click()
  await until(
    () =>
      [...document.querySelectorAll('.completed-results a')].some(
        (item) => item.textContent === label,
      ),
    'Undo did not restore setup link',
  )
  const restored = [...document.querySelectorAll<HTMLAnchorElement>('.completed-results a')].find(
    (item) => item.textContent === label,
  )!
  restored.click()
  await until(() => !!document.querySelector('.result-score'), 'Result link did not open review')
  return { reviewLink: label, deletedAndRestored: true }
}
