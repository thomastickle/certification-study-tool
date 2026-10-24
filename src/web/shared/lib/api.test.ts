import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createWorkspaceApi, InactiveWorkspaceError } from './api.ts'
import { deferred } from '../../../../tests/deferred.ts'

test('browser requests keep their immutable account and preserve caller headers', async (t) => {
  const requests: Headers[] = []
  t.mock.method(globalThis, 'fetch', async (_path: string, options: RequestInit) => {
    requests.push(new Headers(options.headers))
    return new Response(null, { status: 204 })
  })
  const alice = createWorkspaceApi('alice')
  const pending = alice.fetch('/api/questions/1', {
    method: 'DELETE',
    headers: { 'X-Example': 'preserved' },
  })
  const bob = createWorkspaceApi('bob')
  await pending
  await bob.fetch('/api/questions')
  await alice.fetch('/api/questions')
  assert.equal(requests[0]!.get('X-Study-Account'), 'alice')
  assert.equal(requests[0]!.get('X-Example'), 'preserved')
  assert.equal(requests[1]!.get('X-Study-Account'), 'bob')
  assert.equal(requests[2]!.get('X-Study-Account'), 'alice')
})

test('workspace replacement expires only its originating client and prevents further requests', async (t) => {
  let expirations = 0
  let requests = 0
  t.mock.method(globalThis, 'fetch', async () => {
    requests++
    return Response.json({ code: 'workspace_changed', error: 'Account changed.' }, { status: 409 })
  })
  const alice = createWorkspaceApi('alice', () => {
    expirations++
  })
  await assert.rejects(alice.api('/questions/1', { method: 'DELETE' }), /Account changed/)
  assert.equal(expirations, 1)
  assert.equal(alice.isActive(), false)
  await assert.rejects(alice.api('/questions'), InactiveWorkspaceError)
  assert.equal(requests, 1)
})

test('a late account-mismatch response must not expire a newer workspace', async (t) => {
  let expirations = 0
  const pending = deferred<Response>()
  t.mock.method(globalThis, 'fetch', () => pending.promise)
  const alice = createWorkspaceApi('alice', () => {
    expirations++
  })
  const oldRequest = alice.api('/questions')
  alice.invalidate()
  const bob = createWorkspaceApi('bob', () => {
    expirations++
  })
  pending.resolve(
    Response.json({ code: 'workspace_changed', error: 'Account changed.' }, { status: 409 }),
  )
  await assert.rejects(oldRequest, InactiveWorkspaceError)
  assert.equal(expirations, 0, 'The old Alice response must not expire the new Bob workspace')
  assert.equal(bob.isActive(), true)
})

test('invalidating a workspace while a success body is parsed suppresses the obsolete result', async (t) => {
  const body = deferred<unknown>()
  const parsing = deferred<void>()
  const response = Response.json({})
  t.mock.method(response, 'json', () => {
    parsing.resolve()
    return body.promise
  })
  t.mock.method(globalThis, 'fetch', async () => response)
  const alice = createWorkspaceApi('alice')
  const pending = alice.api('/questions')
  await parsing.promise
  alice.invalidate()
  body.resolve({ total: 20, items: [{ question: 'Alice private question' }] })
  await assert.rejects(pending, InactiveWorkspaceError)
})

test('concurrent authorization failures expire a workspace only once', async (t) => {
  const responses = deferred<void>()
  let expirations = 0
  t.mock.method(globalThis, 'fetch', async () => {
    await responses.promise
    return Response.json({ error: 'Sign in required.' }, { status: 401 })
  })
  const workspace = createWorkspaceApi('alice', () => {
    expirations++
  })
  const requests = [workspace.api('/sources'), workspace.api('/questions')]
  responses.resolve()
  const results = await Promise.allSettled(requests)
  assert.equal(
    results.every((result) => result.status === 'rejected'),
    true,
  )
  assert.equal(expirations, 1)
  assert.equal(workspace.isActive(), false)
})
