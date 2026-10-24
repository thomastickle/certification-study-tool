import assert from 'node:assert/strict'
import { test } from 'node:test'
import { api, apiFetch, setApiAccount } from './api.ts'

test('browser requests carry the displayed account and preserve caller headers', async (t) => {
  const requests: Headers[] = []
  t.mock.method(globalThis, 'fetch', async (_path: string, options: RequestInit) => {
    requests.push(new Headers(options.headers))
    return new Response(null, { status: 204 })
  })
  t.after(() => setApiAccount(undefined))
  setApiAccount('alice')
  const pending = apiFetch('/api/questions/1', {
    method: 'DELETE',
    headers: { 'X-Example': 'preserved' },
  })
  setApiAccount('bob')
  await pending
  await apiFetch('/api/questions')
  assert.equal(requests[0]!.get('X-Study-Account'), 'alice')
  assert.equal(requests[0]!.get('X-Example'), 'preserved')
  assert.equal(requests[1]!.get('X-Study-Account'), 'bob')
})

test('workspace replacement tells the session gate to remove stale UI', async (t) => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const browser = new EventTarget()
  Object.defineProperty(globalThis, 'window', { configurable: true, value: browser })
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, 'window', descriptor)
    else Reflect.deleteProperty(globalThis, 'window')
    setApiAccount(undefined)
  })
  let expired = false
  browser.addEventListener('study-session-expired', () => {
    expired = true
  })
  t.mock.method(globalThis, 'fetch', async () =>
    Response.json({ code: 'workspace_changed', error: 'Account changed.' }, { status: 409 }),
  )
  setApiAccount('alice')
  await assert.rejects(api('/questions/1', { method: 'DELETE' }), /Account changed/)
  assert.equal(expired, true)
})
