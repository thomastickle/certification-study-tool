import { setTimeout } from 'node:timers/promises'

/** Confirm the current process answers health checks after a container start or restart.
 * @throws {Error} When the health endpoint does not become available before the deadline.
 */
export async function waitForApplication(origin: URL, timeoutMs = 30_000): Promise<void> {
  const deadline = performance.now() + timeoutMs
  while (performance.now() < deadline) {
    try {
      const response = await fetch(new URL('/api/health', origin), {
        headers: { Connection: 'close' },
        signal: AbortSignal.timeout(Math.max(1, Math.ceil(deadline - performance.now()))),
      })
      await response.arrayBuffer()
      if (response.status === 200) {
        return
      }
    } catch {
      // A restarted process may not accept connections yet. Only this safe probe is retried.
    }
    await setTimeout(Math.min(100, Math.max(0, deadline - performance.now())))
  }
  throw new Error('Application health endpoint did not become ready before its deadline.')
}
