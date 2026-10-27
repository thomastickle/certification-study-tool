import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { applicationRequestHandler } from '../src/server/request-handler.ts'
import { staticWebHandler, developmentWebHandler } from '../src/server/web-handler.ts'
import { closeServer } from './oidc-fixture.ts'

for (const mode of ['static', 'development'] as const) {
  test(`${mode} serving consumes admitted context instead of the raw target`, async () => {
    const directory = mkdtempSync(join(tmpdir(), 'study-web-context-'))
    writeFileSync(join(directory, 'asset.js'), 'synthetic asset')
    const url = Object.freeze({ pathname: '/asset.js', search: '?v=one+two&v=%2F' })
    const web =
      mode === 'static'
        ? staticWebHandler(directory)
        : developmentWebHandler((request, response) => {
            response.end(request.url)
          })
    const server = createServer(
      applicationRequestHandler({
        authentication: { handle: async () => ({ route: 'public', url }) },
        study: () => {
          throw new Error('Public context must keep its classification')
        },
        web,
      }),
    )
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    assert.ok(address && typeof address !== 'string')
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/missing.js?wrong=true`)
      assert.equal(response.status, 200)
      assert.equal(
        await response.text(),
        mode === 'static' ? 'synthetic asset' : '/asset.js?v=one+two&v=%2F',
      )
      assert.deepEqual(url, { pathname: '/asset.js', search: '?v=one+two&v=%2F' })
    } finally {
      await closeServer(server)
      rmSync(directory, { recursive: true, force: true })
    }
  })
}

test('static serving retains shell fallback, method, decoding and containment rules', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'study-static-rules-'))
  writeFileSync(join(directory, 'index.html'), '<title>Synthetic shell</title>')
  writeFileSync(join(directory, 'asset.js'), 'synthetic asset')
  const cases = [
    { pathname: '/', method: 'GET', status: 200, body: '<title>Synthetic shell</title>' },
    { pathname: '/workspace', method: 'GET', status: 200, body: '<title>Synthetic shell</title>' },
    { pathname: '/asset.js', method: 'HEAD', status: 200, body: '' },
    { pathname: '/asset.js', method: 'POST', status: 405, body: '' },
    { pathname: '/missing.js', method: 'GET', status: 404, body: 'Not found.' },
    { pathname: '/%ZZ', method: 'GET', status: 404, body: 'Not found.' },
    { pathname: '/..%2Foutside', method: 'GET', status: 404, body: 'Not found.' },
  ]
  const web = staticWebHandler(directory)
  const server = createServer(
    applicationRequestHandler({
      authentication: {
        handle: async (request) => {
          const scenario = cases[Number(request.headers['x-scenario'])]!
          return {
            route: 'public',
            url: Object.freeze({ pathname: scenario.pathname, search: '?v=1' }),
          }
        },
      },
      study: () => {
        throw new Error('Public context must not select an actor')
      },
      web,
    }),
  )
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  try {
    for (const [index, scenario] of cases.entries()) {
      const response: Response = await fetch(`http://127.0.0.1:${address.port}/`, {
        method: scenario.method,
        headers: { 'X-Scenario': String(index) },
      })
      assert.equal(response.status, scenario.status, scenario.pathname)
      assert.equal(await response.text(), scenario.body, scenario.pathname)
      if (scenario.status === 200) {
        assert.equal(response.headers.get('cache-control'), 'no-cache')
        assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
        assert.equal(
          response.headers.get('content-type'),
          scenario.pathname === '/asset.js' ? 'text/javascript' : 'text/html',
        )
      }
    }
  } finally {
    await closeServer(server)
    rmSync(directory, { recursive: true, force: true })
  }
})
