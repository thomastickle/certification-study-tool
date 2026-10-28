import assert from 'node:assert/strict'
import { createServer, request } from 'node:http'
import { once } from 'node:events'
import { test } from 'node:test'
import { PublicWeb } from '../../src/server/public-web.ts'
import { requestUrl } from '../../src/server/request-url.ts'

for (const finished of [false, true]) {
  test(`public drain retains returned work after response termination (finished=${finished})`, async () => {
    let enter!: () => void
    let release!: () => void
    const entered = new Promise<void>((resolve) => {
      enter = resolve
    })
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const web = new PublicWeb(async (_request, response) => {
      if (finished) {
        response.end('done')
      }
      enter()
      await gate
    })
    const server = createServer((req, res) => {
      void web.handle(req, res, requestUrl(new URL('http://localhost/')))
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    assert.ok(address && typeof address !== 'string')
    const req = request(`http://127.0.0.1:${address.port}`)
    req.on('error', () => {})
    req.on('response', (res) => res.resume())
    req.end()
    try {
      await entered
      await web.close()
      server.closeAllConnections()
      let drained = false
      const draining = web.drain().then(() => {
        drained = true
      })
      await new Promise<void>((resolve) => setImmediate(resolve))
      assert.equal(drained, false, 'terminated HTTP cannot release still-running handler work')
      release()
      await draining
    } finally {
      release()
      req.destroy()
      server.close()
      await once(server, 'close')
    }
  })
}

test('void middleware remains owned until its unfinished HTTP response is aborted', async () => {
  let enter!: () => void
  const entered = new Promise<void>((resolve) => {
    enter = resolve
  })
  const web = new PublicWeb(() => {
    enter()
  })
  const server = createServer((req, res) => {
    void web.handle(req, res, requestUrl(new URL('http://localhost/')))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const req = request(`http://127.0.0.1:${address.port}`)
  req.on('error', () => {})
  req.end()
  try {
    await entered
    await web.close()
    let drained = false
    const draining = web.drain().then(() => {
      drained = true
    })
    await new Promise<void>((resolve) => setImmediate(resolve))
    assert.equal(drained, false)
    server.closeAllConnections()
    await draining
  } finally {
    req.destroy()
    server.closeAllConnections()
    server.close()
    await once(server, 'close')
  }
})

for (const phase of ['before', 'partial', 'ended'] as const) {
  test(`public handler rejection is contained after ${phase} response`, async () => {
    const web = new PublicWeb(async (_request, response) => {
      if (phase === 'partial') {
        response.write('partial')
      }
      if (phase === 'ended') {
        response.end('complete')
      }
      throw new Error('synthetic private detail')
    })
    const server = createServer((req, res) => {
      void web.handle(req, res, requestUrl(new URL('http://localhost/')))
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    assert.ok(address && typeof address !== 'string')
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}`).catch(() => undefined)
      if (phase === 'before') {
        assert.equal(response?.status, 500)
        assert.doesNotMatch(await response!.text(), /synthetic private detail/)
      } else if (phase === 'ended') {
        assert.equal(await response!.text(), 'complete')
      } else if (response) {
        await assert.rejects(response.text())
      }
      await web.drain()
    } finally {
      await web.close()
      server.closeAllConnections()
      server.close()
      await once(server, 'close')
    }
  })
}
