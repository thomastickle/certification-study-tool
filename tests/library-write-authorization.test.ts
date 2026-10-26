import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { test } from 'node:test'
import { apiController } from '../src/server/http-controller.ts'
import { LibraryRepository } from '../src/server/questions/library-repository.ts'
import { ImportService } from '../src/server/importer/import-service.ts'
import { ConceptService } from '../src/server/concepts/concept-service.ts'
import { bank } from './fixtures.ts'
import { closeServer } from './oidc-fixture.ts'

/** Give each scenario fresh synthetic banks and a verified server-side actor. */
async function fixture(role: 'admin' | 'student', prefix: string) {
  const shared = new LibraryRepository(':memory:')
  const privateLibrary = new LibraryRepository(':memory:')
  const input = bank()
  input.questions.push({
    ...structuredClone(input.questions[0]!),
    source_ref: '2',
    question: 'Another synthetic question?',
  })
  for (const repository of [shared, privateLibrary]) {
    const importer = new ImportService(repository)
    importer.confirm(input, importer.preview(input).token, true)
  }
  const content = prefix === '/api/private' ? privateLibrary : shared
  const concepts = new ConceptService(content)
  const candidate = concepts.suggestions()[0]!
  const group = concepts.save({ ...candidate, name: 'Existing review' })
  const server = createServer(
    apiController(shared, { id: 'alice', role }, undefined, undefined, privateLibrary),
  )
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')

  /** Forged browser identity must never override the actor or destination. */
  const call = (path: string, method: string, data: object = {}) =>
    fetch(`http://127.0.0.1:${address.port}${prefix}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Study-Role': 'admin',
        'X-Account-Id': 'bob',
      },
      ...(method === 'GET'
        ? {}
        : { body: JSON.stringify({ ...data, role: 'admin', accountId: 'bob' }) }),
    })

  return {
    shared,
    privateLibrary,
    content,
    input: { ...input, source: { ...input.source, key: 'new-synthetic-bank' } },
    candidate,
    group,
    call,
    close: async () => {
      await closeServer(server)
      privateLibrary.close()
      shared.close()
    },
  }
}

type Fixture = Awaited<ReturnType<typeof fixture>>

const mutations = [
  { name: 'import preview', path: () => '/imports/preview', method: 'POST', status: 200 },
  { name: 'import confirm', path: () => '/imports/confirm', method: 'POST', status: 201 },
  { name: 'question deletion', path: () => '/questions/1', method: 'DELETE', status: 204 },
  { name: 'source deletion', path: () => '/sources/1', method: 'DELETE', status: 204 },
  { name: 'concept creation', path: () => '/concepts', method: 'POST', status: 201 },
  {
    name: 'concept editing',
    path: (app: Fixture) => `/concepts/${app.group.id}`,
    method: 'PUT',
    status: 200,
  },
  {
    name: 'concept deletion',
    path: (app: Fixture) => `/concepts/${app.group.id}`,
    method: 'DELETE',
    status: 200,
  },
  {
    name: 'suggestion dismissal',
    path: (app: Fixture) => `/concept-suggestions/${app.candidate.id}/dismiss`,
    method: 'POST',
    status: 200,
  },
]

for (const prefix of ['/api', '/api/shared', '/api/private']) {
  for (const role of ['admin', 'student'] as const) {
    for (const mutation of mutations) {
      test(`${role} ${prefix}: ${mutation.name} uses verified library permission`, async () => {
        const app = await fixture(role, prefix)
        try {
          if (mutation.name === 'suggestion dismissal') {
            app.content.conceptStore().remove(app.group.id)
          }
          const groupsBefore = new ConceptService(app.content).groups()
          const suggestionsBefore = new ConceptService(app.content).suggestions()
          const questionsBefore = app.content.allQuestions()
          const before = app.content.revision()
          const other = prefix === '/api/private' ? app.shared : app.privateLibrary
          const otherBefore = other.revision()
          const allowed = role === 'admin' || prefix === '/api/private'
          let token = 'untrusted-ticket'
          if (allowed && mutation.name === 'import confirm') {
            const preview = await app.call('/imports/preview', 'POST', { bank: app.input })
            assert.equal(preview.status, 200)
            token = (await preview.json()).token
          }
          const response = await app.call(mutation.path(app), mutation.method, {
            ...app.candidate,
            name: 'Updated review',
            bank: app.input,
            token,
            reviewed: true,
          })
          assert.equal(response.status, allowed ? mutation.status : 403)
          assert.equal(other.revision(), otherBefore, 'another destination stays unchanged')
          if (allowed) {
            const service = new ConceptService(app.content)
            switch (mutation.name) {
              case 'import preview':
                assert.equal(typeof (await response.json()).token, 'string')
                assert.equal(app.content.revision(), before, 'preview does not import content')
                break
              case 'import confirm':
                assert.equal(app.content.allQuestions().length, 4)
                assert.equal((await response.json()).token, token)
                break
              case 'question deletion':
                assert.equal(app.content.allQuestions().length, 1)
                break
              case 'source deletion':
                assert.deepEqual(app.content.sources(), [])
                break
              case 'concept creation':
                assert.equal(service.groups().length, 2)
                assert.ok(service.groups().some((group) => group.name === 'Updated review'))
                break
              case 'concept editing':
                assert.equal(service.groups()[0]!.name, 'Updated review')
                break
              case 'concept deletion':
                assert.deepEqual(service.groups(), [])
                break
              case 'suggestion dismissal':
                assert.deepEqual(service.suggestions(), [])
                assert.deepEqual(service.groups(), [])
                break
            }
          }
          if (!allowed) {
            assert.equal(app.content.revision(), before, 'denial has no content side effects')
            assert.deepEqual(new ConceptService(app.content).groups(), groupsBefore)
            assert.deepEqual(new ConceptService(app.content).suggestions(), suggestionsBefore)
            assert.deepEqual(app.content.allQuestions(), questionsBefore)
          }
        } finally {
          await app.close()
        }
      })
    }
  }
}

test('unknown writes never enter content operations; normalized reads remain public', async () => {
  const app = await fixture('student', '/api/shared')
  try {
    const before = app.shared.revision()
    for (const path of ['/imports/unknown', '/questions/1/unknown', '/concept-suggestions']) {
      assert.equal((await app.call(path, 'POST', { bank: app.input })).status, 404)
    }
    assert.equal(app.shared.revision(), before)
    assert.equal((await app.call('/imports/../concepts?role=admin', 'GET')).status, 200)
  } finally {
    await app.close()
  }
})
