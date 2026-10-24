let accountId: string | undefined

/** Bind requests to the account confirmed before mounting the current workspace. */
export function setApiAccount(id: string | undefined): void {
  accountId = id
}

/** A stale tab must not silently send its displayed operations to a replacement login. */
export function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const headers = new Headers(options.headers)
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  headers.set('X-Study-Account', accountId ?? '')
  return fetch(path, { ...options, headers })
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await apiFetch('/api' + path, options)
  if (!response.ok) {
    const result = await response.json()
    if (response.status === 401 || result.code === 'workspace_changed') {
      window.dispatchEvent(new Event('study-session-expired'))
    }
    throw new Error([result.error, ...(result.details ?? [])].join('\n'))
  }
  return response.status === 204 ? (undefined as T) : response.json()
}
