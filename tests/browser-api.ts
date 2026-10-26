import { createWorkspaceApi } from '../src/web/shared/lib/api.ts'

/** Bind standalone browser-check bundles to the account their mounted UI displays. */
export function workspaceFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const workspace = document.querySelector<HTMLElement>('[data-study-account]')
  const account = workspace?.dataset.studyAccount
  if (!account) throw new Error('Browser checks require a signed-in workspace.')
  return createWorkspaceApi(account).fetch(path, options)
}
