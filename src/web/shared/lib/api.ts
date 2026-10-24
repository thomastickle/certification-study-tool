export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch('/api' + path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  })
  if (!response.ok) {
    if (response.status === 401) window.dispatchEvent(new Event('study-session-expired'))
    const result = await response.json()
    throw new Error([result.error, ...(result.details ?? [])].join('\n'))
  }
  return response.status === 204 ? (undefined as T) : response.json()
}
