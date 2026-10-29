import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { staticWebHandler } from '../src/server/web/web-handler.ts'
import { closeServer } from './oidc-fixture.ts'

test('static policy preserves MIME, fallback, symlinks and unconditional full responses', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'study-static-parity-'))
  const root = join(directory, 'public')
  mkdirSync(root)
  mkdirSync(join(root, 'folder'))
  writeFileSync(join(directory, 'outside'), 'owned outside fixture')
  symlinkSync(join(directory, 'outside'), join(root, 'link'))
  symlinkSync('cycle.js', join(root, 'cycle.js'))
  const files = {
    'index.html': ['shell', 'text/html'],
    'asset.js': ['javascript', 'text/javascript'],
    'asset.css': ['css', 'text/css'],
    'asset.svg': ['svg', 'image/svg+xml'],
    'asset.ico': ['ico', 'image/x-icon'],
    'asset.json': ['json', 'application/octet-stream'],
    '.hidden': ['hidden', 'application/octet-stream'],
    'encoded name.js': ['encoded', 'text/javascript'],
  }
  for (const [name, [body]] of Object.entries(files)) {
    writeFileSync(join(root, name), body!)
  }
  const web = staticWebHandler(root)
  const server = createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('Referrer-Policy', 'no-referrer')
    const url = new URL(request.url!, 'http://localhost')
    void web(request, response, Object.freeze({ pathname: url.pathname, search: url.search }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const origin = `http://127.0.0.1:${address.port}`
  try {
    const paths = [
      ...Object.entries(files).map(([name, [body, type]]) => ['/' + encodeURI(name), body!, type!]),
      ['/', 'shell', 'text/html'],
      ['/workspace/', 'shell', 'text/html'],
      ['/link', 'owned outside fixture', 'application/octet-stream'],
    ]
    for (const [path, body, type] of paths) {
      for (const method of ['GET', 'HEAD']) {
        const response = await fetch(origin + path + '?v=%2F&v=two', {
          method,
          headers: {
            Range: 'bytes=0-1',
            'If-None-Match': '*',
            'If-Modified-Since': new Date(0).toUTCString(),
            'If-Match': '"missing"',
            'If-Unmodified-Since': new Date(0).toUTCString(),
          },
        })
        assert.equal(response.status, 200, path)
        assert.equal(await response.text(), method === 'HEAD' ? '' : body, path)
        assert.equal(response.headers.get('content-type'), type, path)
        assert.equal(response.headers.get('cache-control'), 'no-cache')
        assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
        assert.equal(response.headers.get('referrer-policy'), 'no-referrer')
        assert.equal(response.headers.get('content-range'), null)
      }
    }
    for (const path of [
      '/folder',
      '/folder/',
      '/missing.json',
      '/cycle.js',
      '/%ZZ',
      '/..%2Foutside',
    ]) {
      const response = await fetch(origin + path)
      assert.equal(response.status, 404, path)
      assert.equal(await response.text(), 'Not found.')
    }
    for (const method of ['POST', 'PUT']) {
      assert.equal((await fetch(origin + '/', { method })).status, 405)
    }
  } finally {
    await closeServer(server)
    rmSync(directory, { recursive: true, force: true })
  }
})

for (const failureAt of ['open', 'data']) {
  test(`standard static streaming closes its file after an error at ${failureAt}`, async () => {
    const { createRequire } = await import('node:module')
    const { mock } = await import('node:test')
    const fs = createRequire(import.meta.url)('node:fs') as typeof import('node:fs')
    const directory = mkdtempSync(join(tmpdir(), 'study-static-error-'))
    const file = join(directory, 'large.js')
    writeFileSync(file, Buffer.alloc(1024 * 1024, 120))
    const original = fs.createReadStream
    let closed!: Promise<unknown>
    const mocked = mock.method(fs, 'createReadStream', (...args: Parameters<typeof original>) => {
      const stream = original(...args)
      closed = new Promise<void>((resolve) => stream.once('close', resolve))
      stream.once(failureAt, () =>
        queueMicrotask(() => stream.destroy(new Error('synthetic read failure'))),
      )
      return stream
    })
    const web = staticWebHandler(directory)
    const server = createServer((request, response) => {
      void web(request, response, { pathname: '/large.js', search: '' })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    assert.ok(address && typeof address !== 'string')
    try {
      const signal = AbortSignal.timeout(2000)
      if (failureAt === 'open') {
        await assert.rejects(async () => {
          const response = await fetch(`http://127.0.0.1:${address.port}/`, { signal })
          await response.text()
        })
        assert.equal(
          signal.aborted,
          false,
          'Read failure must terminate the response, not wait for a client timeout',
        )
      } else {
        const response = await fetch(`http://127.0.0.1:${address.port}/`, { signal })
        assert.equal(response.status, 200)
        await assert.rejects(response.text())
        assert.equal(signal.aborted, false)
      }
      await closed
    } finally {
      mocked.mock.restore()
      await closeServer(server)
      rmSync(directory, { recursive: true, force: true })
    }
  })
}
