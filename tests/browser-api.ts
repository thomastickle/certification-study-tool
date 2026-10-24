import { apiFetch, setApiAccount } from '../src/web/shared/lib/api.ts'

/** Bind standalone browser-check bundles to the account their mounted UI displays. */
export function workspaceFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const workspace = document.querySelector<HTMLElement>('[data-study-account]')
  setApiAccount(workspace?.dataset.studyAccount)
  return apiFetch(path, options)
}
