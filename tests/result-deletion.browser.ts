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
    click('Reports')
    await until(() => !!document.querySelector('[id^="report-attempt-"]'), 'Reports did not load')
    const first = document.querySelector<HTMLButtonElement>('[id^="report-attempt-"]')!
    const attemptId = first.id.replace('report-attempt-', '')
    first.click()
    await until(() => !!document.querySelector('.result-deletion'), 'Result did not load')
    assert(document.querySelector('button[aria-label="Delete result"] svg'), 'Delete icon missing')
    click('Delete result')
    await until(
      () =>
        !![...document.querySelectorAll('.deleted-results button')].find(
          (button) => button.getAttribute('aria-label') === 'Undo deletion',
        ),
      'Recovery row did not load',
    )
    assert(
      document.querySelector('.deleted-results')?.textContent?.includes('Will be deleted on'),
      'Deletion deadline missing',
    )
    assert(document.querySelector('button[aria-label="Undo deletion"] svg'), 'Undo icon missing')
    assert(!document.getElementById(`report-attempt-${attemptId}`), 'Deleted attempt still counted')
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
      click('Refresh deleted results')
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
    click('Undo deletion')
    await until(
      () => !!document.getElementById(`report-attempt-${attemptId}`),
      'Restored result missing from counted history',
    )
    assert(
      ![...document.querySelectorAll('.deleted-results button')].find(
        (button) => button.getAttribute('aria-label') === 'Undo deletion',
      ),
      'Restored result remains in recovery list',
    )
    if (staleRead) {
      releaseRead!()
      await new Promise((resolve) => setTimeout(resolve, 100))
      assert(
        ![...document.querySelectorAll('.deleted-results button')].find(
          (button) => button.getAttribute('aria-label') === 'Undo deletion',
        ),
        'Stale read reinserted restored row',
      )
    }
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
