import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { test } from 'node:test'
import { benchmarkWorkerLifetime } from './benchmark-worker-lifetime.ts'

for (const boundary of ['work', 'shutdown']) {
  test(
    `watchdog kills a synchronous child stalled during ${boundary}`,
    { timeout: 10_000 },
    async (t) => {
      const script = `
      process.on('SIGTERM', () => process.exit(1))
      process.on('${boundary === 'work' ? 'message' : 'disconnect'}', () => {
        while (true) {}
      })
      process.send('ready')
    `
      const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      })
      t.after(() => child.kill('SIGKILL'))
      try {
        await once(child, 'message')
        const lifetime = benchmarkWorkerLifetime(child, 50, 50)
        if (boundary === 'work') {
          child.send('start')
          assert.equal((await lifetime.exited).signal, 'SIGKILL')
          await assert.rejects(lifetime.stop(), /terminated/)
        } else {
          await assert.rejects(lifetime.stop(), /terminated/)
          assert.equal((await lifetime.exited).signal, 'SIGKILL')
        }
        assert.equal(lifetime.signal.aborted, true)
      } finally {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill('SIGKILL')
          await once(child, 'exit')
        }
      }
    },
  )
}

test('normal IPC shutdown exits without termination', async () => {
  const child = spawn(
    process.execPath,
    ['-e', "process.on('disconnect', () => process.exit(0)); process.send('ready')"],
    {
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    },
  )
  const lifetime = benchmarkWorkerLifetime(child)
  try {
    await once(child, 'message')
    await lifetime.stop()
    assert.deepEqual(await lifetime.exited, { code: 0, signal: null })
    assert.equal(lifetime.signal.aborted, false)
  } finally {
    child.kill('SIGKILL')
  }
})

test('failure cleanup terminates a child that ignores SIGTERM', { timeout: 10_000 }, async (t) => {
  const child = spawn(
    process.execPath,
    ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000); process.send('ready')"],
    {
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    },
  )
  t.after(() => child.kill('SIGKILL'))
  const lifetime = benchmarkWorkerLifetime(child, 60_000, 50)
  await once(child, 'message')
  const result = await lifetime.stop(true)
  assert.equal(result.signal, 'SIGKILL')
  assert.equal(lifetime.signal.aborted, true)
})

test('spawn failure releases the watchdog without waiting for an exit event', async () => {
  const child = spawn('/nonexistent-study-benchmark-executable')
  const lifetime = benchmarkWorkerLifetime(child)
  await once(child, 'error')
  assert.deepEqual(await lifetime.stop(true), { code: null, signal: null })
})
