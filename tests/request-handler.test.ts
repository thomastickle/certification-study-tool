import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { setImmediate } from 'node:timers/promises'
import { test } from 'node:test'
import { applicationRequestHandler } from '../src/server/request-handler.ts'
import type { ApplicationHandlers } from '../src/server/request-handler.ts'
import { requestUrl } from '../src/server/request-url.ts'
import { closeServer } from './oidc-fixture.ts'

for (const failure of ['authentication', 'controller construction', 'study', 'web'] as const) {
  test(`a rejected ${failure} request returns a safe error and leaves the server available`, async () => {
    const handlers: ApplicationHandlers = {
      authentication: {
        handle: async (request) => {
          if (request.url === '/healthy') {
            return { route: 'public', url: requestUrl(new URL(request.url!, 'http://localhost')) }
          }
          if (failure === 'authentication') {
            throw new Error('Sensitive authentication failure detail')
          }
          if (failure === 'web') {
            return { route: 'public', url: requestUrl(new URL(request.url!, 'http://localhost')) }
          }
          return {
            route: 'study',
            user: { id: 'alice', name: 'Alice', role: 'student' },
            url: requestUrl(new URL(request.url!, 'http://localhost')),
          }
        },
      },
      study: () => {
        if (failure === 'controller construction') {
          throw new Error('Sensitive controller construction failure detail')
        }
        return async () => {
          await Promise.resolve()
          throw new Error('Sensitive study failure detail')
        }
      },
      web: async (request, response) => {
        if (request.url === '/healthy') {
          response.end('Available')
          return
        }
        await Promise.resolve()
        throw new Error('Sensitive web failure detail')
      },
    }
    const server = createServer(applicationRequestHandler(handlers))
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    assert.ok(address && typeof address !== 'string')
    const origin = `http://127.0.0.1:${address.port}`
    try {
      const failed = await fetch(origin + '/fail', { signal: AbortSignal.timeout(2000) })
      assert.equal(failed.status, 500)
      assert.equal(failed.headers.get('cache-control'), 'no-store')
      assert.deepEqual(await failed.json(), {
        error: 'The request could not be completed. Please retry.',
      })
      assert.equal(await (await fetch(origin + '/healthy')).text(), 'Available')
    } finally {
      await closeServer(server)
    }
  })
}

for (const state of ['partial', 'ended'] as const) {
  test(`a late failure preserves a ${state} response without breaking later requests`, async () => {
    const handlers: ApplicationHandlers = {
      authentication: {
        handle: async (request) => ({
          route: 'public',
          url: requestUrl(new URL(request.url!, 'http://localhost')),
        }),
      },
      study: () => {
        throw new Error('Public requests must never construct a study controller')
      },
      web: async (request, response) => {
        if (request.url === '/healthy') {
          response.end('Available')
          return
        }
        response.writeHead(200)
        if (state === 'partial') {
          response.write('Partial')
        } else {
          response.end('Complete')
        }
        await setImmediate()
        throw new Error('Sensitive late failure detail')
      },
    }
    const server = createServer(applicationRequestHandler(handlers))
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    assert.ok(address && typeof address !== 'string')
    const origin = `http://127.0.0.1:${address.port}`
    try {
      const body = fetch(origin + '/fail').then((response) => response.text())
      if (state === 'partial') {
        await assert.rejects(body, /terminated|fetch failed/)
      } else {
        assert.equal(await body, 'Complete')
      }
      assert.equal(await (await fetch(origin + '/healthy')).text(), 'Available')
    } finally {
      await closeServer(server)
    }
  })
}
