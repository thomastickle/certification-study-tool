import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { test } from 'node:test'
import { apiController } from '../src/server/http-controller.ts'
import { LibraryRepository } from '../src/server/questions/library-repository.ts'
import { bank } from './fixtures.ts'

test('HTTP supports preview, confirm, browse and scoped deletion while denying cross-site writes', async () => {
  const repository = new LibraryRepository(':memory:')
  const server = createServer(apiController(repository))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const base = `http://127.0.0.1:${address.port}`

  const post = (path: string, data: unknown, origin = base) =>
    fetch(base + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify(data),
    })

  try {
    const input = bank()
    assert.equal(
      (await post('/api/imports/preview', { bank: input }, 'https://untrusted.example')).status,
      403,
    )
    const previewResponse = await post('/api/imports/preview', { bank: input })
    assert.equal(previewResponse.status, 200)
    const preview = await previewResponse.json()
    assert.equal(
      (await post('/api/imports/confirm', { bank: input, token: preview.token, reviewed: false }))
        .status,
      201,
    )
    const page = await (await fetch(base + '/api/questions')).json()
    assert.equal(page.total, 1)
    assert.equal(
      (
        await fetch(base + '/api/questions/' + page.items[0].id, {
          method: 'DELETE',
          headers: { Origin: 'https://untrusted.example' },
        })
      ).status,
      403,
    )
    assert.equal(
      (await fetch(base + '/api/questions/' + page.items[0].id, { method: 'DELETE' })).status,
      204,
    )
    const sources = await (await fetch(base + '/api/sources')).json()
    assert.equal(
      (await fetch(base + '/api/sources/' + sources[0].id, { method: 'DELETE' })).status,
      204,
    )
    assert.deepEqual(await (await fetch(base + '/api/sources')).json(), [])
    assert.equal((await fetch(base + '/api/questions?page=-1')).status, 400)
    assert.equal(
      (
        await fetch(base + '/api/imports/preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{broken',
        })
      ).status,
      400,
    )
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
    repository.close()
  }
})
