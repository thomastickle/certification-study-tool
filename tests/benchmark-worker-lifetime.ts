import type { ChildProcess } from 'node:child_process'

/** Own a benchmark child from launch through exit, including a stalled shutdown. */
export function benchmarkWorkerLifetime(worker: ChildProcess, timeoutMs = 180_000, graceMs = 1000) {
  const abort = new AbortController()
  let escalation: ReturnType<typeof setTimeout> | undefined
  let finished = false

  /** SIGTERM permits fixture cleanup; SIGKILL also handles synchronous stalls. */
  function terminate() {
    if (finished || escalation) {
      return
    }
    abort.abort(new Error('Benchmark worker terminated before clean shutdown'))
    worker.kill('SIGTERM')
    escalation = setTimeout(() => worker.kill('SIGKILL'), graceMs)
  }

  const timeout = setTimeout(terminate, timeoutMs)

  /** Release timers and parent signal handlers only after child exit or spawn failure. */
  function cleanup() {
    finished = true
    clearTimeout(timeout)
    clearTimeout(escalation)
    process.off('SIGTERM', interrupted)
    process.off('SIGINT', interrupted)
  }

  /** Parent interruption still gives the synthetic worker a bounded cleanup attempt. */
  function interrupted() {
    process.exitCode = 1
    terminate()
  }

  process.on('SIGTERM', interrupted)
  process.on('SIGINT', interrupted)

  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    worker.once('exit', (code, signal) => {
      cleanup()
      resolve({ code, signal })
    })
    worker.once('error', () => {
      if (!worker.pid) {
        cleanup()
        resolve({ code: null, signal: null })
      } else {
        terminate()
      }
    })
  })

  /**
   * Retain the watchdog through IPC disconnect; failures request immediate termination.
   * @throws {Error} When timeout/interruption prevents a requested clean shutdown.
   */
  async function stop(failed = false) {
    if (failed) {
      terminate()
    }
    if (worker.connected) {
      worker.disconnect()
    }
    const result = await exited
    if (abort.signal.aborted && !failed) {
      throw abort.signal.reason
    }
    return result
  }

  return { signal: abort.signal, exited, stop }
}
