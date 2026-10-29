import { ApplicationRuntime } from '../../src/server/runtime/application-runtime.ts'
import { LibraryHttpModule } from '../../src/server/library-http/library-http.module.ts'
import { libraryFixture } from './library-http-fixture.ts'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ImportService } from '../../src/server/importer/import-service.ts'
import { bank } from '../fixtures.ts'

/** Exercise both actors against one Nest graph and separate owned personal files. */
async function fixture(aliceRole: 'admin' | 'student' = 'student') {
  const f = await libraryFixture(undefined, [LibraryHttpModule])
  if (aliceRole === 'student') {
    f.administrators.delete('alice')
  }
  const runtime = f.app.get(ApplicationRuntime)
  const users: {
    id: string
    library: ReturnType<typeof runtime.privateLibraries.open>
    call: (path: string, data?: unknown, method?: string) => Promise<Response>
  }[] = []
  for (const subject of ['alice', 'bob']) {
    const cookie = await f.login(subject)
    const id = f.sessions.get(cookie)!
    const library = runtime.privateLibraries.open(id)

    const call = async (path: string, data?: unknown, method = 'POST') => {
      const result = await f.authorized(
        path,
        cookie,
        method,
        { 'Content-Type': 'application/json' },
        data === undefined ? undefined : JSON.stringify(data),
      )
      return new Response(result.body || null, { status: result.status })
    }

    users.push({ id: subject, library, call })
  }
  return {
    shared: runtime.sharedLibrary,
    alice: users[0]!,
    bob: users[1]!,
    close: async () => {
      for (const user of users) {
        user.library.close()
      }
      await f.close()
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

test('verified login and study requests leave unprovisioned workspace paths absent', async () => {
  const { fixture } = await import('./study-http-fixture.ts')
  const { StudyHttpModule } = await import('../../src/server/study-http/study.module.ts')
  const { existsSync } = await import('node:fs')
  const f = await fixture(undefined, [LibraryHttpModule, StudyHttpModule])
  try {
    const cookie = await f.login('pending', '', false)
    assert.equal(existsSync(f.config.privateLibrariesDirectory), false)
    for (const path of ['/api/home', '/api/questions', '/api/quizzes']) {
      const response = await f.authorized(path, cookie)
      assert.equal(response.status, 503, path)
      assert.match(response.body, /provision/i)
      assert.equal(existsSync(f.config.privateLibrariesDirectory), false)
    }
  } finally {
    await f.close()
  }
})
