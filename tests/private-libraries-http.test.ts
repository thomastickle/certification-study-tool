import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { apiTestHandler } from './support/api-test-handler.ts'
import { LibraryRepository } from '../src/server/questions/library-repository.ts'
import { ImportService } from '../src/server/importer/import-service.ts'
import { ImportPreviews } from '../src/server/importer/import-previews.ts'
import { bank } from './fixtures.ts'
import { closeServer } from './oidc-fixture.ts'

/** Keep colliding local IDs in genuinely separate files while exercising the HTTP boundary. */
async function fixture(aliceRole: 'admin' | 'student' = 'student') {
  const directory = mkdtempSync(join(tmpdir(), 'study-private-banks-'))
  const shared = new LibraryRepository(join(directory, 'shared.sqlite3'))
  const previews = new ImportPreviews()

  const users = await Promise.all(
    ['alice', 'bob'].map(async (id) => {
      const library = new LibraryRepository(join(directory, `${id}.sqlite3`))
      const actor = { id, role: id === 'alice' ? aliceRole : ('student' as const) }
      const server = createServer(apiTestHandler(shared, actor, undefined, previews, library))
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
      const address = server.address()
      assert.ok(address && typeof address !== 'string')
      const origin = `http://127.0.0.1:${address.port}`

      const call = (path: string, data?: unknown, method = 'POST') =>
        fetch(origin + path, {
          method,
          headers: { 'Content-Type': 'application/json' },
          ...(data === undefined ? {} : { body: JSON.stringify(data) }),
        })

      return { id, library, server, call }
    }),
  )

  return {
    shared,
    alice: users[0]!,
    bob: users[1]!,
    close: async () => {
      for (const user of users) {
        await closeServer(user.server)
        user.library.close()
      }
      shared.close()
      rmSync(directory, { recursive: true, force: true })
    },
  }
}

test('students manage their private banks without discovering or changing another library', async () => {
  const app = await fixture()
  try {
    const input = bank('same-key')
    const shared = new ImportService(app.shared)
    shared.confirm(input, shared.preview(input).token, false)
    for (const user of [app.alice, app.bob]) {
      const own = structuredClone(input)
      own.questions[0]!.question = `${user.id}'s private synthetic question?`
      const preview = await user.call('/api/private/imports/preview', { bank: own })
      assert.equal(preview.status, 200)
      const { token } = await preview.json()
      const confirmed = await user.call('/api/private/imports/confirm', {
        bank: own,
        token,
        reviewed: false,
      })
      assert.equal(confirmed.status, 201)
    }
    assert.equal(app.shared.allQuestions().length, 1)
    assert.equal(app.alice.library.allQuestions().length, 1)
    assert.equal(app.bob.library.allQuestions().length, 1)
    const visible = await app.alice.call('/api/private/questions', undefined, 'GET')
    assert.equal(visible.status, 200)
    const page = await visible.json()
    assert.equal(page.total, 1)
    assert.match(page.items[0].data.question, /^alice/)
    assert.equal((await app.alice.call('/api/private/sources/1', undefined, 'DELETE')).status, 204)
    assert.equal(app.alice.library.sources().length, 0)
    assert.equal(app.bob.library.sources().length, 1)
    assert.equal(app.shared.sources().length, 1)
    assert.equal((await app.alice.call('/api/shared/sources/1', undefined, 'DELETE')).status, 403)
    assert.equal((await app.alice.call('/api/private/quizzes', {}, 'POST')).status, 404)
  } finally {
    await app.close()
  }
})

test('private previews reject foreign accounts and shared destinations without consuming the valid ticket', async () => {
  const app = await fixture('admin')
  try {
    const input = bank('private-ticket')
    const preview = await app.alice.call('/api/private/imports/preview', { bank: input })
    assert.equal(preview.status, 200)
    const { token } = await preview.json()
    const confirmation = { bank: input, token, reviewed: false, accountId: 'bob', role: 'admin' }
    assert.equal((await app.bob.call('/api/private/imports/confirm', confirmation)).status, 409)
    assert.equal((await app.alice.call('/api/shared/imports/confirm', confirmation)).status, 409)
    assert.equal((await app.alice.call('/api/private/imports/confirm', confirmation)).status, 201)
    assert.equal((await app.alice.call('/api/private/imports/confirm', confirmation)).status, 409)
    assert.equal(app.bob.library.allQuestions().length, 0)
    assert.equal(app.shared.allQuestions().length, 0)
    const sources = await app.alice.call('/api/sources', undefined, 'GET')
    assert.equal(sources.status, 200)
    assert.deepEqual(
      (await sources.json()).map((source: { id: unknown }) => source.id),
      ['private:1'],
    )
    assert.equal((await app.bob.call('/api/sources', undefined, 'GET')).status, 200)
  } finally {
    await app.close()
  }
})
