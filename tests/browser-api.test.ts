import assert from 'node:assert/strict'
import { test } from 'node:test'
import { workspaceFetch } from './browser-api.ts'

test('browser inspection requests bind the displayed account while bypassing interceptors', async (t) => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document')
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { querySelector: () => ({ dataset: { studyAccount: 'displayed-owner' } }) },
  })
  t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('Synthetic intercepted request')
  })
  let calls = 0

  const nativeFetch: typeof fetch = async (path, options) => {
    calls++
    assert.equal(path, '/api/quizzes/attempt')
    assert.equal(new Headers(options?.headers).get('X-Study-Account'), 'displayed-owner')
    assert.equal(options?.method, 'DELETE')
    return new Response(null, { status: 204 })
  }

  try {
    const response = await workspaceFetch('/api/quizzes/attempt', { method: 'DELETE' }, nativeFetch)
    assert.equal(response.status, 204)
    assert.equal(calls, 1)
  } finally {
    if (previous) {
      Object.defineProperty(globalThis, 'document', previous)
    } else {
      Reflect.deleteProperty(globalThis, 'document')
    }
  }
})
