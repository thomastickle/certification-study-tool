import assert from 'node:assert/strict'
import { test } from 'node:test'
import { summarize, TimerProbe } from './performance-metrics.ts'

test('latency summaries retain sample counts and nearest-rank tails', () => {
  assert.deepEqual(summarize([4, 1, 3, 2]), { count: 4, min: 1, median: 2, p95: 4, max: 4 })
  assert.throws(() => summarize([]), /sample/)
})

test('the probe drains a pending timer after the final synchronous operation', async () => {
  let sampled = false
  let monotonic = 0
  const probe = new TimerProbe(
    () => {
      sampled = true
    },
    () => monotonic,
  )
  // Model a synchronous operation completing before any timer callback can run.
  monotonic = 50
  assert.equal(sampled, false)
  const result = await probe.stop()
  assert.equal(sampled, true)
  assert.ok(result.samples > 0)
  assert.equal(result.maxGapMs, 50)
  assert.equal(result.maxExcessMs, 49)
})
