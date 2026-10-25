import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { test } from 'node:test'
import { waitForApplication } from './support/application-readiness.ts'

test('readiness waits for a live successful health response after startup', async () => {
  let ready = false
  let disconnect = true

  let markStartup: () => void = () => {}

  const observedStartup = new Promise<void>((resolve) => {
    markStartup = resolve
  })
  const server = createServer((request, response) => {
    assert.equal(request.url, '/api/health')
    if (ready && disconnect) {
      disconnect = false
      request.socket.destroy()
      return
    }
    response.writeHead(ready ? 200 : 503).end()
    markStartup()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  try {
    const waiting = waitForApplication(new URL(`http://127.0.0.1:${address.port}`))
    await observedStartup
    ready = true
    await waiting
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test(
  'readiness fails within its deadline when the application never becomes ready',
  { timeout: 1000 },
  async () => {
    const server = createServer((_request, response) => response.writeHead(503).end())
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    assert.ok(address && typeof address !== 'string')
    try {
      await assert.rejects(
        waitForApplication(new URL(`http://127.0.0.1:${address.port}`), 50),
        /did not become ready/,
      )
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  },
)
