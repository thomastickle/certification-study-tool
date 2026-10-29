import assert from 'node:assert/strict'
import { fork } from 'node:child_process'
import { once } from 'node:events'
import { existsSync } from 'node:fs'
import { test } from 'node:test'
import { benchmarkWorkerLifetime } from '../benchmark-worker-lifetime.ts'

test('benchmark worker uses authenticated Nest admission rather than actor headers', async () => {
  const worker = fork(
    new URL('../foreground-benchmark-worker.js', import.meta.url),
    [JSON.stringify({ owners: 2, histories: 2, questions: 48, backlog: 1 })],
    { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] },
  )
  const lifetime = benchmarkWorkerLifetime(worker)
  try {
    const [message] = await once(worker, 'message')
    const { origin, actors, requestOrigin } = message.ready
    assert.equal(
      (
        await fetch(origin + '/api/sources', {
          headers: { 'x-synthetic-actor': '0', Host: new URL(requestOrigin ?? origin).host },
        })
      ).status,
      401,
    )
    const response = await fetch(origin + '/api/sources', {
      headers: { ...actors[0], Host: new URL(requestOrigin ?? origin).host },
    })
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff')
    assert.equal(
      (
        await fetch(origin + '/api/sources', {
          headers: {
            ...actors[0],
            Host: new URL(requestOrigin ?? origin).host,
            'X-Study-Account': 'wrong',
          },
        })
      ).status,
      409,
    )
    assert.deepEqual(await lifetime.stop(), { code: 0, signal: null })
    assert.equal(existsSync(message.ready.syntheticDirectory), false)
    await assert.rejects(fetch(origin + '/api/health', { signal: AbortSignal.timeout(1000) }))
  } finally {
    await lifetime.stop(true)
  }
})
