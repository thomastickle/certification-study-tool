/** Bind inspection/cleanup to the displayed account, optionally bypassing a test interceptor. */
export function workspaceFetch(
  path: string,
  options: RequestInit = {},
  request: typeof fetch = window.fetch,
): Promise<Response> {
  const workspace = document.querySelector<HTMLElement>('[data-study-account]')
  const account = workspace?.dataset.studyAccount
  if (!account) throw new Error('Browser checks require a signed-in workspace.')
  const headers = new Headers(options.headers)
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  headers.set('X-Study-Account', account)
  return request(path, { ...options, headers })
}
