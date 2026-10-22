import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

const resourceFields = [
  'userCpuSeconds',
  'systemCpuSeconds',
  'peakRssKiB',
  'majorFaults',
  'minorFaults',
  'voluntaryContextSwitches',
  'involuntaryContextSwitches',
  'fsInputOperations',
  'fsOutputOperations',
]
const resourceFormat = 'resource-v1\t%U\t%S\t%M\t%F\t%R\t%w\t%c\t%I\t%O'

/** Parse GNU time's Linux rusage counters without converting operations to bytes.
 * @throws {Error} If the measurement is absent, malformed, negative or non-finite.
 */
export function parseResources(text) {
  const lines = text
    .trim()
    .split('\n')
    .filter((line) => line.startsWith('resource-v1\t'))
  const values = lines[0]?.split('\t').slice(1) ?? []
  if (
    lines.length !== 1 ||
    values.length !== resourceFields.length ||
    values.some(
      (value, index) =>
        !/^\d+(?:\.\d+)?$/.test(value) ||
        !Number.isFinite(Number(value)) ||
        (index >= 2 && !Number.isSafeInteger(Number(value))),
    )
  ) {
    throw new Error('Invalid or missing resource measurement')
  }
  return Object.fromEntries(resourceFields.map((field, index) => [field, Number(values[index])]))
}

/** Sum sequential phase counters; RSS is the largest phase high-water mark, never a tree sum. */
export function aggregateResources(phases, ms) {
  const result = Object.fromEntries(
    resourceFields.map((field) => [
      field,
      field === 'peakRssKiB'
        ? Math.max(...phases.map((phase) => phase[field]))
        : phases.reduce((sum, phase) => sum + phase[field], 0),
    ]),
  )
  result.averageCpuPercent = (100 * (result.userCpuSeconds + result.systemCpuSeconds)) / (ms / 1000)
  result.fsInputOperationsPerSecond = result.fsInputOperations / (ms / 1000)
  result.fsOutputOperationsPerSecond = result.fsOutputOperations / (ms / 1000)
  return result
}

/** Take medians of successful per-run counters and rates, not ratios of separate medians. */
export function summarizeResources(samples) {
  const resources = samples
    .filter((sample) => sample.ok && sample.resources)
    .map((sample) => sample.resources)
  if (!resources.length) {
    return null
  }
  return Object.fromEntries(
    Object.keys(resources[0]).map((field) => [
      field,
      summarize(resources.map((resource) => ({ ok: true, ms: resource[field] }))).median,
    ]),
  )
}

/** Measure each fresh command with GNU time; missing counters fail the pipeline. */
export function measure(commands, cwd, { timeBinary = '/usr/bin/time' } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'compiler-resources-'))
  const resourcePath = join(directory, 'resources.txt')
  const start = performance.now()
  const steps = []
  try {
    for (const [command, ...args] of commands) {
      rmSync(resourcePath, { force: true })
      const phaseStart = performance.now()
      const result = spawnSync(
        timeBinary,
        ['-o', resourcePath, '-f', resourceFormat, '--', command, ...args],
        {
          cwd,
          encoding: 'utf8',
          timeout: 120_000,
          maxBuffer: 16 * 1024 * 1024,
        },
      )
      const ms = performance.now() - phaseStart
      const step = {
        status: result.status,
        signal: result.signal,
        error: result.error?.message,
        stdout: result.stdout,
        stderr: result.stderr,
        ms,
      }
      try {
        step.resources = aggregateResources(
          [parseResources(readFileSync(resourcePath, 'utf8'))],
          ms,
        )
      } catch {
        step.measurementError = 'Invalid or missing resource measurement'
      }
      steps.push(step)
      if (result.status !== 0 || result.error || step.measurementError) {
        break
      }
    }
    const ms = performance.now() - start
    return {
      ok:
        steps.length > 0 &&
        steps.every((step) => step.status === 0 && !step.error && !step.measurementError),
      ms,
      steps,
      resources:
        steps.length && steps.every((step) => step.resources)
          ? aggregateResources(
              steps.map((step) => step.resources),
              ms,
            )
          : null,
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

/** Persist sanitized results before reporting baseline or instrumentation failures.
 * @throws {Error} After saving, if a baseline or any resource measurement failed.
 */
export function writeSummary(path, summary) {
  writeFileSync(path, JSON.stringify(summary, null, 2))
  const groups = [...Object.entries(summary.samples), ...Object.entries(summary.warmups ?? {})]
  const baselineFailed = groups.some(
    ([name, samples]) =>
      ['ts59-check', 'ts59-build', 'vite'].includes(name) && samples.some((sample) => !sample.ok),
  )
  const measurementFailed = groups.some(([, samples]) =>
    samples.some((sample) => sample.measurementError),
  )
  if (measurementFailed) {
    throw new Error('Resource measurement failed; inspect the saved summary')
  }
  if (baselineFailed) {
    throw new Error('Baseline measurement failed; inspect the saved summary')
  }
}
