export type Api = <T>(path: string, options?: RequestInit) => Promise<T>

export type WorkspaceApi = {
  readonly accountId: string
  api: Api
  fetch: (path: string, options?: RequestInit) => Promise<Response>
  invalidate: () => void
  isActive: () => boolean
}

/** An obsolete workspace cannot start requests or deliver late results into its replacement. */
export class InactiveWorkspaceError extends Error {
  constructor() {
    super('This workspace is no longer active.')
  }
}

/** Each workspace owns a fixed account binding and an independently revocable lifetime. */
export function createWorkspaceApi(accountId: string, onExpired = () => {}): WorkspaceApi {
  let active = true

  function assertActive(): void {
    if (!active) {
      throw new InactiveWorkspaceError()
    }
  }

  async function workspaceFetch(path: string, options: RequestInit = {}): Promise<Response> {
    assertActive()
    const headers = new Headers(options.headers)
    if (!headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json')
    }
    headers.set('X-Study-Account', accountId)
    const response = await fetch(path, { ...options, headers })
    assertActive()
    return response
  }

  async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
    const response = await workspaceFetch('/api' + path, options)
    if (!response.ok) {
      const result = await response.json()
      assertActive()
      if (response.status === 401 || result.code === 'workspace_changed') {
        active = false
        onExpired()
      }
      throw new Error([result.error, ...(result.details ?? [])].join('\n'))
    }
    const result = response.status === 204 ? undefined : await response.json()
    assertActive()
    return result as T
  }

  return {
    accountId,
    api,
    fetch: workspaceFetch,
    invalidate: () => {
      active = false
    },
    isActive: () => active,
  }
}
