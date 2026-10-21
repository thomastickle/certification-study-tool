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
      (item) => item.textContent?.trim() === label && !item.disabled,
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
    click('Delete result')
    await until(
      () => !!document.querySelector('.deleted-results button.danger'),
      'Recovery row did not load',
    )
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
      !document.querySelector('.deleted-results button.danger'),
      'Restored result remains in recovery list',
    )
    if (staleRead) {
      releaseRead!()
      await new Promise((resolve) => setTimeout(resolve, 100))
      assert(
        !document.querySelector('.deleted-results button.danger'),
        'Stale read reinserted restored row',
      )
    }
    assert(!lostRestore || restoreCommitted, 'Lost response was not exercised')
    assert(confirmations === 0, 'Deletion requested confirmation')
    return { lostRestore, staleRead, restored: attemptId, confirmations }
  } finally {
    releaseRead?.()
    window.fetch = originalFetch
    window.confirm = originalConfirm
  }
}
