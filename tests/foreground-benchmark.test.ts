import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { test } from 'node:test'

interface Row {
  phase?: string
  httpLatencyMs?: { count: number }
  server?: {
    requestServiceMs: { count: number }
    actorServiceMs: { count: number }[]
    memory: { start: { rss: number }; end: { rss: number }; sampledPeakRss: number }
    observations: number
    opens: number
    activeConnections: number
    peakConnections: number
    timerDelay: { samples: number }
  }
  measurement?: { opens: number; activeConnections: number }
  result?: { histories: number; otherHistories: number; cursor: number; isolated: boolean }
}

test('synthetic HTTP benchmark reports measured requests separately and preserves owner evidence', async () => {
  const script = fileURLToPath(new URL('./foreground-benchmark.ts', import.meta.url))
  const { stdout } = await promisify(execFile)(process.execPath, [script, 'small', '1'], {
    timeout: 60_000,
  })
  const rows: Row[] = stdout
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
  const requests = rows.filter((row) => row.server)
  assert.equal(requests.length, 10)
  assert.equal(
    requests.reduce((sum, row) => sum + row.httpLatencyMs!.count, 0),
    29,
  )
  for (const row of requests) {
    const count = row.httpLatencyMs!.count
    assert.equal(row.server!.requestServiceMs.count, count)
    assert.equal(
      row.server!.actorServiceMs.reduce((sum, actor) => sum + actor.count, 0),
      count,
    )
    assert.ok(row.server!.memory.start.rss > 0)
    assert.ok(row.server!.memory.end.rss > 0)
    assert.ok(row.server!.memory.sampledPeakRss >= row.server!.memory.start.rss)
    assert.equal(row.server!.opens, count)
    assert.equal(row.server!.observations, count)
    assert.equal(row.server!.activeConnections, 0)
    assert.ok(row.server!.peakConnections >= 1 && row.server!.peakConnections <= 4)
    assert.ok(row.server!.timerDelay.samples > 0)
  }
  const contention = rows.find((row) => row.phase === 'contention-by-actor')!
  assert.ok(Array.isArray(contention.httpLatencyMs))
  assert.deepEqual(
    contention.httpLatencyMs.map((actor) => actor.count),
    [10, 10],
  )
  assert.equal(rows.find((row) => row.phase === 'due-read')!.httpLatencyMs!.count, 1)
  assert.equal(rows.find((row) => row.phase === 'startup-recovery')!.measurement!.opens, 10)
  assert.equal(rows.find((row) => row.phase === 'recurring-reconciliation')!.measurement!.opens, 10)
  assert.deepEqual(rows.find((row) => row.phase === 'correctness')!.result, {
    histories: 12,
    otherHistories: 11,
    cursor: 2,
    isolated: true,
  })
})
