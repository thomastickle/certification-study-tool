import { workspaceFetch } from './browser-api.ts'

/** Run in the app against the dedicated synthetic issue16 database, with no initial groups. */
export async function conceptsBrowserTest(): Promise<string> {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  async function until(predicate: () => boolean, message: string) {
    const deadline = Date.now() + 5000
    while (!predicate()) {
      assert(Date.now() < deadline, message)
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
  }

  function button(label: string, root: ParentNode = document) {
    const found = [...root.querySelectorAll('button')].find(
      (item) => item.textContent?.trim() === label,
    )
    assert(found && !found.disabled, `Missing enabled button: ${label}`)
    return found
  }

  function input(label: string, value: string) {
    const element = document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)
    assert(element, `Missing input: ${label}`)
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    setter.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
  }

  async function state() {
    const response = await workspaceFetch('/api/concepts')
    assert(response.ok, 'Concept API failed')
    return response.json()
  }

  button('Library').click()
  await until(() => !!document.querySelector('.concept-panel'), 'Library did not load')
  const panel = document.querySelector<HTMLDetailsElement>('.concept-panel')!
  panel.open = true
  await until(
    () =>
      !![...panel.querySelectorAll('button')].find(
        (item) => item.textContent === 'Review suggestion',
      ),
    'Suggestions did not load',
  )
  assert((await state()).groups.length === 0, 'Suggestions activated without review')
  button('Review suggestion', panel).click()
  await until(() => !!document.querySelector('.concept-editor'), 'Review editor did not open')
  const memberDetails = document.querySelector<HTMLDetailsElement>('.concept-member details')!
  memberDetails.open = true
  assert(memberDetails.textContent?.includes('Library #'), 'Library provenance missing')
  assert(memberDetails.textContent?.includes('Correct'), 'Answers missing from review')
  const checkboxes = [
    ...document.querySelectorAll<HTMLInputElement>('.concept-member input[type="checkbox"]'),
  ]
  assert(checkboxes.length >= 3, 'Synthetic fixture needs at least three variations')
  for (const checkbox of checkboxes.slice(2)) {
    if (checkbox.checked) {
      checkbox.click()
    }
  }
  input('Concept name', 'Reviewed synthetic pair')
  await new Promise((resolve) => setTimeout(resolve, 0))
  button('Activate reviewed group', panel).click()
  await until(() => !document.querySelector('.concept-editor'), 'Activation failed')
  let saved = await state()
  assert(
    saved.groups.length === 1 && saved.groups[0].members.length === 2,
    'Subset activation failed',
  )
  await until(
    () => panel.textContent?.includes('Reviewed synthetic pair') === true,
    'Saved group did not render',
  )
  button('Edit group', panel).click()
  await until(() => !!document.querySelector('.concept-editor'), 'Edit editor did not open')
  input('Concept name', 'Renamed synthetic pair')
  await new Promise((resolve) => setTimeout(resolve, 0))
  button('Save reviewed group', panel).click()
  await until(() => !document.querySelector('.concept-editor'), 'Edit failed')
  saved = await state()
  assert(saved.groups[0].name === 'Renamed synthetic pair', 'Rename was not persisted')
  await until(
    () => panel.textContent?.includes('Renamed synthetic pair') === true,
    'Rename did not render',
  )
  button('Delete group', panel).click()
  await until(
    () =>
      [...panel.querySelectorAll('button')].some(
        (item) => item.textContent?.trim() === 'Confirm delete group',
      ),
    'Delete confirmation did not open',
  )
  button('Confirm delete group', panel).click()
  await until(
    () => panel.textContent?.includes('No reviewed groups yet.') === true,
    'Removal did not render',
  )
  assert((await state()).groups.length === 0, 'Group was not removed')
  button('Create concept group', panel).click()
  await until(() => !!document.querySelector('.concept-editor'), 'Manual editor did not open')
  input('Concept name', 'Manual synthetic group')
  const first = document.querySelector<HTMLInputElement>('.concept-member input[type="checkbox"]')!
  first.click()
  await new Promise((resolve) => setTimeout(resolve, 0))
  button('Activate reviewed group', panel).click()
  await until(() => !document.querySelector('.concept-editor'), 'Manual creation failed')
  assert((await state()).groups[0].members.length === 1, 'Manual membership was not persisted')
  button('Delete group', panel).click()
  await until(
    () =>
      [...panel.querySelectorAll('button')].some(
        (item) => item.textContent?.trim() === 'Confirm delete group',
      ),
    'Delete confirmation did not open',
  )
  button('Confirm delete group', panel).click()
  await until(
    () => panel.textContent?.includes('No reviewed groups yet.') === true,
    'Manual cleanup failed',
  )
  button('Dismiss suggestion', panel).click()
  await until(
    () => panel.textContent?.includes('Suggestion dismissed.') === true,
    'Dismissal failed',
  )
  assert((await state()).groups.length === 0, 'Dismissal activated a group')
  const catalog = (await state()).library[0]
  const pair = catalog.members.filter((member: { occurrences: { reference: string }[] }) =>
    ['d1-0', 'd1-5'].includes(member.occurrences[0]!.reference),
  )
  assert(pair.length === 2, 'Selection fixture needs an old and an unseen variation')
  const createdResponse = await workspaceFetch('/api/concepts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...catalog, name: 'Browser selection pair', members: pair }),
  })
  assert(createdResponse.ok, 'Could not activate selection fixture')
  const created = await createdResponse.json()
  button('Quiz').click()
  await until(
    () =>
      [...document.querySelectorAll('button')].some(
        (item) => item.textContent?.trim() === 'Start 20-question quiz' && !item.disabled,
      ),
    'Quiz setup did not load',
  )
  button('Start 20-question quiz').click()
  await until(() => !!document.querySelector('.question-navigation'), 'Quiz did not start')
  const current = await (await workspaceFetch('/api/quizzes/current?mode=quiz')).json()
  assert(
    current.questions.some((question: { reference: string }) => question.reference === 'd1-5'),
    'Unseen variation was not selected',
  )
  assert(
    !current.questions.some((question: { reference: string }) => question.reference === 'd1-0'),
    'Recent sibling repeated unnecessarily',
  )
  assert(
    JSON.stringify(
      [1, 2, 3, 4].map(
        (domain) =>
          current.questions.filter((question: { domain: number }) => question.domain === domain)
            .length,
      ),
    ) === '[5,6,7,2]',
    'Concept selection changed domain quotas',
  )
  await workspaceFetch(`/api/quizzes/${current.id}/abandon`, { method: 'POST' })
  await workspaceFetch(`/api/concepts/${created.id}`, { method: 'DELETE' })
  return 'PASS: inactive suggestions, content/provenance review, subset activation, edit, deletion, manual creation dismissal, and UI-started normal selection with quotas'
}
