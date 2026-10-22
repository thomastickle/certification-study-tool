import { spawnSync } from 'node:child_process'
import { performance } from 'node:perf_hooks'

/** Summarize successful wall-clock samples without disguising failures. */
export function summarize(samples) {
  const times = samples
    .filter((sample) => sample.ok)
    .map((sample) => sample.ms)
    .sort((a, b) => a - b)
  const middle = Math.floor(times.length / 2)
  let median = null
  if (times.length) {
    median = times.length % 2 ? times[middle] : (times[middle - 1] + times[middle]) / 2
  }
  return {
    successful: times.length,
    failed: samples.length - times.length,
    median,
    min: times[0] ?? null,
    max: times.at(-1) ?? null,
  }
}

/** Run a fresh process for each command and time the whole pipeline. */
export function measure(commands, cwd) {
  const start = performance.now()
  const steps = []
  for (const [command, ...args] of commands) {
    const result = spawnSync(command, args, {
      cwd,
      encoding: 'utf8',
      timeout: 120_000,
      maxBuffer: 16 * 1024 * 1024,
    })
    steps.push({
      status: result.status,
      signal: result.signal,
      error: result.error?.message,
      stdout: result.stdout,
      stderr: result.stderr,
    })
    if (result.status !== 0 || result.error) {
      break
    }
  }
  return {
    ok: steps.every((step) => step.status === 0 && !step.error),
    ms: performance.now() - start,
    steps,
  }
}
