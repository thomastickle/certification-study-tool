import assert from 'node:assert/strict'
import test from 'node:test'
import process from 'node:process'
import { measure, summarize } from './measure.mjs'

test('failed early exits cannot be reported as successful timings', () => {
  assert.deepEqual(
    summarize([
      { ok: false, ms: 1 },
      { ok: true, ms: 12 },
      { ok: true, ms: 8 },
    ]),
    {
      successful: 2,
      failed: 1,
      median: 10,
      min: 8,
      max: 12,
    },
  )
  assert.deepEqual(summarize([{ ok: false, ms: 1 }]), {
    successful: 0,
    failed: 1,
    median: null,
    min: null,
    max: null,
  })
})

test('a rejected typecheck prevents the bundler from running', () => {
  const result = measure([
    [process.execPath, '-e', 'process.exit(2)'],
    [process.execPath, '-e', "console.log('bundler must not run')"],
  ])
  assert.equal(result.ok, false)
  assert.equal(result.steps.length, 1)
  assert.equal(result.steps[0].status, 2)
})

test('baseline failures are summarized on disk before the harness fails', async () => {
  const { writeSummary } = await import('./measure.mjs')
  const { mkdtempSync, readFileSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const directory = mkdtempSync(join(tmpdir(), 'benchmark-test-'))
  const path = join(directory, 'summary.json')
  const summary = { samples: { 'ts59-check': [{ ok: false }], vite: [{ ok: true }] } }
  try {
    assert.throws(() => writeSummary(path, summary), /Baseline/)
    assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), summary)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('GNU counters retain KiB and operation units and reject broken measurements', async () => {
  const { parseResources } = await import('./measure.mjs')
  const resources = parseResources('resource-v1\t1.5\t0.5\t2048\t2\t30\t4\t5\t6\t8\n')
  assert.equal(resources.peakRssKiB, 2048)
  assert.equal(resources.fsInputOperations, 6)
  assert.equal(resources.fsOutputOperations, 8)
  for (const text of ['', 'resource-v1\tNaN', 'resource-v1\t-1\t0\t1\t0\t0\t0\t0\t0\t0']) {
    assert.throws(() => parseResources(text), /resource/i)
  }
})

test('pipeline sums CPU and counters, takes phase high-water max, and computes each run rate', async () => {
  const { parseResources, aggregateResources, summarizeResources } = await import('./measure.mjs')
  const phase = parseResources('resource-v1\t1.5\t0.5\t2048\t2\t30\t4\t5\t6\t8\n')
  const first = aggregateResources([phase, { ...phase, peakRssKiB: 1024 }], 1000)
  assert.equal(first.userCpuSeconds, 3)
  assert.equal(first.averageCpuPercent, 400)
  assert.equal(first.peakRssKiB, 2048)
  assert.equal(first.fsInputOperations, 12)
  assert.equal(first.fsInputOperationsPerSecond, 12)
  const second = aggregateResources([phase], 4000)
  const third = aggregateResources([phase], 10000)
  assert.equal(
    summarizeResources([first, second, third].map((resources) => ({ ok: true, resources })))
      .fsInputOperationsPerSecond,
    1.5,
  )
})

test('missing or broken measurement cannot succeed or launch the next phase', () => {
  for (const timeBinary of ['/nonexistent-compiler-benchmark-time', '/usr/bin/true']) {
    const result = measure(
      [
        [process.execPath, '-e', ''],
        [process.execPath, '-e', ''],
      ],
      undefined,
      { timeBinary },
    )
    assert.equal(result.ok, false)
    assert.equal(result.steps.length, 1)
    assert.match(result.steps[0].measurementError, /resource/i)
  }
})

test('real measurement captures waited children and per-phase resources', () => {
  const result = measure([
    [
      process.execPath,
      '-e',
      "require('node:child_process').execFileSync(process.execPath, ['-e', 'for(let t=Date.now();Date.now()-t<150;){}'])",
    ],
  ])
  assert.equal(result.ok, true)
  assert.ok(result.resources.userCpuSeconds > 0.05)
  assert.ok(result.steps[0].resources.peakRssKiB > 0)
})

test('summary rejects broken experimental measurements and baseline warmup failures', async () => {
  const { writeSummary } = await import('./measure.mjs')
  const { mkdtempSync, existsSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const directory = mkdtempSync(join(tmpdir(), 'benchmark-summary-'))
  const path = join(directory, 'summary.json')
  try {
    assert.throws(
      () =>
        writeSummary(path, { samples: { 'tsrs-check': [{ ok: false, measurementError: true }] } }),
      /Resource/,
    )
    assert.ok(existsSync(path))
    assert.throws(
      () =>
        writeSummary(path, {
          samples: { vite: [{ ok: true }] },
          warmups: { vite: [{ ok: false }] },
        }),
      /Baseline/,
    )
    assert.doesNotThrow(() => writeSummary(path, { samples: { 'tsrs-check': [{ ok: false }] } }))
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
