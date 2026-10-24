import assert from 'node:assert/strict'
import { test } from 'node:test'
import { pauseCertificationAttempts } from '../src/web/app/workspace-session.ts'
import { createWorkspaceApi, InactiveWorkspaceError } from '../src/web/shared/lib/api.ts'
import { deferred } from './deferred.ts'

const certification = {
  provider: 'Example',
  code: 'DEMO-1',
  name: 'Example',
  organization: 'Example',
  platform: 'Example',
  level: 'General',
  aliases: [],
}

test('an old action awaiting its leave guard cannot pause replacement-account attempts', async (t) => {
  const leave = deferred<void>()
  let bobPaused = false
  let requests = 0
  t.mock.method(globalThis, 'fetch', async (path: string, options: RequestInit) => {
    requests++
    const account = new Headers(options.headers).get('X-Study-Account')
    if (options.method === 'POST') {
      if (account === 'bob') bobPaused = true
      return Response.json({ id: 'attempt', status: 'paused' })
    }
    return Response.json({ id: `${account}-attempt`, status: 'active' })
  })
  const alice = createWorkspaceApi('alice')
  const oldAction = (async () => {
    await leave.promise
    await pauseCertificationAttempts(certification, alice)
  })()
  alice.invalidate()
  const bob = createWorkspaceApi('bob')
  leave.resolve()
  await assert.rejects(oldAction, InactiveWorkspaceError)
  assert.equal(bobPaused, false, 'Alice must not pause Bob after an awaited UI guard')
  assert.equal(requests, 0)
  assert.equal(bob.isActive(), true)
})

test('a workspace switch during attempt recovery suppresses all follow-up pauses', async (t) => {
  const reads = deferred<Response>()
  let pauses = 0
  t.mock.method(globalThis, 'fetch', async (_path: string, options: RequestInit) => {
    if (options.method === 'POST') {
      pauses++
      return Response.json({ status: 'paused' })
    }
    return reads.promise
  })
  const alice = createWorkspaceApi('alice')
  const pending = pauseCertificationAttempts(certification, alice)
  alice.invalidate()
  const bob = createWorkspaceApi('bob')
  reads.resolve(Response.json({ id: 'alice-attempt', status: 'active' }))
  await assert.rejects(pending, InactiveWorkspaceError)
  assert.equal(pauses, 0)
  assert.equal(bob.isActive(), true)
})
