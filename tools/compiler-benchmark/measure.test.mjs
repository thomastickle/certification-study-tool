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
