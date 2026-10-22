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

/** Completion actions retain the answer review while marking and restoring its saved evidence. */
export async function completionResultDeletionCheck() {
  const originalFetch = window.fetch

  /** Waits for the saved mutation to be reflected in the visible completion card. */
  async function until(predicate: () => boolean, message: string) {
    const deadline = Date.now() + 5000
    while (!predicate()) {
      if (Date.now() >= deadline) throw new Error(message)
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
  }

  const practice = [...document.querySelectorAll<HTMLButtonElement>('nav button')].find(
    (button) => button.textContent?.trim() === 'Practice',
  )!
  practice.click()
  await until(() => !!document.querySelector('.completed-results a'), 'History missing')
  const link = document.querySelector<HTMLAnchorElement>('.completed-results a')!
  const id = link.closest('li')!.dataset.resultId!
  link.click()
  await until(() => !!document.querySelector('.result-score'), 'Completion card missing')
  const answers = document.querySelectorAll('.result-question').length
  // Select the old control too, so the original navigation bug is exercised by the red run.
  document.querySelector<HTMLButtonElement>('.result-icon-delete')!.click()
  await until(
    () => !!document.querySelector('.result-score .deletion-deadline'),
    'Deletion must keep the completion card open and show its deadline',
  )
  if (document.querySelectorAll('.result-question').length !== answers) {
    throw new Error('Deletion discarded the visible answer review')
  }
  if (document.querySelector('.result-deletion')) throw new Error('Separate deletion panel remains')
  const undo = document.querySelector<HTMLButtonElement>(
    '.result-score button[title="Undo deletion"]',
  )!
  if (!undo || !document.querySelector('.result-score .deletion-deadline time[datetime]')) {
    throw new Error('Completion card needs an undo action and dated deletion notice')
  }
  undo.click()
  await until(
    () => !!document.querySelector('.result-score button[title="Mark for deletion"]'),
    'Undo must restore the action without leaving the result',
  )
  if (document.querySelector('.result-score .deletion-deadline')) {
    throw new Error('Undo left a stale deletion deadline')
  }
  const action = document.querySelector<HTMLButtonElement>(
    '.result-score button[title="Mark for deletion"]',
  )!
  if (!action.closest('.result-completion-heading')?.textContent?.includes('COMPLETE')) {
    throw new Error('Deletion action must share the completion heading')
  }
  try {
    window.fetch = async (input, init) => {
      if (String(input) === `/api/quizzes/${id}` && init?.method === 'DELETE') {
        throw new Error('Synthetic deletion failure')
      }
      return originalFetch(input, init)
    }
    action.click()
    await until(
      () => !!document.querySelector('.result-score [role="alert"]'),
      'Failed deletion must show an inline error',
    )
    if (!document.querySelector('.result-score button[title="Mark for deletion"]:not(:disabled)')) {
      throw new Error('Failed deletion must leave the result open and allow retry')
    }
  } finally {
    window.fetch = originalFetch
  }
  return { retainedReview: true, restored: id, inlineFailure: true }
}

/** Lost mutation responses must reconcile the saved status before offering another action. */
export async function completionDeletionRecoveryCheck() {
  const originalFetch = window.fetch
  let lostDelete = false
  let lostRestore = false
  window.fetch = async (input, init) => {
    const response = await originalFetch(input, init)
    if (response.ok && init?.method === 'DELETE' && !lostDelete) {
      lostDelete = true
      throw new Error('Synthetic lost deletion response')
    }
    if (response.ok && String(input).endsWith('/restore') && !lostRestore) {
      lostRestore = true
      throw new Error('Synthetic lost restore response')
    }
    return response
  }
  try {
    for (const [action, expected] of [
      ['Mark for deletion', 'Undo deletion'],
      ['Undo deletion', 'Mark for deletion'],
    ]) {
      const button = document.querySelector<HTMLButtonElement>(
        `.result-score button[title="${action}"]`,
      )!
      button.click()
      const deadline = Date.now() + 5000
      while (!document.querySelector(`.result-score button[title="${expected}"]:not(:disabled)`)) {
        if (Date.now() >= deadline) throw new Error(`Lost response did not reconcile ${expected}`)
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
    }
    if (!lostDelete || !lostRestore || document.querySelector('.result-score .deletion-deadline')) {
      throw new Error('Both lost responses must leave a restored result open')
    }
    return { lostDelete, lostRestore }
  } finally {
    window.fetch = originalFetch
  }
}
