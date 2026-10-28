import assert from 'node:assert/strict'
import { LibraryHttpModule } from '../../src/server/library-http/library-http.module.ts'
import { bank } from '../fixtures.ts'
import { mock, test } from 'node:test'
import { setImmediate } from 'node:timers/promises'
import { StudyInputWork } from '../../src/server/security/study-input-work.ts'
import { libraryFixture } from './library-http-fixture.ts'

test('compiled library lists authenticate and expose normalized first-value queries', async () => {
  const f = await libraryFixture(undefined, [LibraryHttpModule])
  try {
    const alice = await f.login('alice')
    assert.equal((await f.call('/api/questions')).status, 401)
    assert.equal((await f.authorized('/api/questions?page=1&page=bad', alice)).status, 200)
  } finally {
    await f.close()
  }
})

test('library aliases preserve role ordering, raw path shapes and media contracts', async () => {
  const f = await libraryFixture(undefined, [LibraryHttpModule])
  try {
    const admin = await f.login('alice')
    const student = await f.login('bob')
    for (const prefix of ['/api', '/api/shared', '/api/private']) {
      for (const resource of ['sources', 'questions', 'concepts']) {
        const response = await f.authorized(`${prefix}/${resource}`, student)
        assert.equal(response.status, 200)
        assert.equal(response.headers['cache-control'], 'no-store')
        assert.equal(response.headers['x-content-type-options'], 'nosniff')
        for (const method of ['HEAD', 'OPTIONS', 'PATCH']) {
          assert.equal((await f.authorized(`${prefix}/${resource}`, student, method)).status, 404)
        }
      }
      for (const path of [
        'questions/no',
        'sources/%31',
        'concepts/' + 'A'.repeat(36),
        'concepts/' + '%61'.repeat(36),
      ]) {
        assert.equal((await f.authorized(`${prefix}/${path}`, student, 'DELETE')).status, 404)
      }
      const shared = prefix !== '/api/private'
      assert.equal(
        (await f.authorized(`${prefix}/sources/0`, student, 'DELETE')).status,
        shared ? 403 : 400,
      )
      assert.equal((await f.authorized(`${prefix}/sources/0`, admin, 'DELETE')).status, 400)
      assert.equal(
        (await f.authorized(`${prefix}/imports/preview`, student, 'POST', {}, '{')).status,
        shared ? 403 : 415,
      )
      assert.equal(
        (await f.authorized(`${prefix}/imports/preview`, admin, 'POST', {}, '{')).status,
        415,
      )
      for (const value of ['{', 'null', '[]']) {
        assert.equal(
          (
            await f.authorized(
              `${prefix}/imports/preview`,
              admin,
              'POST',
              { 'Content-Type': 'application/json' },
              value,
            )
          ).status,
          400,
        )
      }
      assert.equal((await f.authorized(`${prefix}/questions?page=0`, admin)).status, 400)
      assert.equal((await f.authorized(`${prefix}/questions?sourceId=0`, admin)).status, 400)
      assert.equal((await f.authorized(`${prefix}/quizzes`, admin)).status, 404)
    }
  } finally {
    await f.close()
  }
})

test('real OIDC users isolate colliding content, ticket ownership and namespace swaps', async () => {
  const f = await libraryFixture(undefined, [LibraryHttpModule])
  try {
    const alice = await f.login('alice')
    const bob = await f.login('bob')
    const carol = await f.login('carol')

    const json = (path: string, actor: string, input: unknown, method = 'POST') =>
      f.authorized(
        path,
        actor,
        method,
        { 'Content-Type': 'application/json' },
        JSON.stringify(input),
      )

    const read = async (path: string, actor: string) =>
      JSON.parse((await f.authorized(path, actor)).body)

    const preview = async (prefix: string, actor: string, input: unknown) => {
      const response = await json(`${prefix}/imports/preview`, actor, { bank: input })
      assert.equal(response.status, 200)
      return JSON.parse(response.body).token as string
    }

    for (const [actor, prefix, key] of [
      [alice, '/api', 'shared'],
      [bob, '/api/private', 'bob'],
      [carol, '/api/private', 'carol'],
    ] as const) {
      const input = bank(key)
      input.questions[0]!.question = `${key} synthetic content?`
      const token = await preview(prefix, actor, input)
      const confirm = { bank: input, token, reviewed: false }
      if (actor === bob) {
        assert.equal((await json('/api/private/imports/confirm', carol, confirm)).status, 409)
        assert.equal((await json('/api/shared/imports/confirm', bob, confirm)).status, 403)
      }
      assert.equal((await json(`${prefix}/imports/confirm`, actor, confirm)).status, 201)
      assert.equal((await json(`${prefix}/imports/confirm`, actor, confirm)).status, 409)
    }
    const input = bank('swap')
    const token = await preview('/api/private', alice, input)
    const confirm = { bank: input, token, reviewed: false }
    assert.equal((await json('/api/shared/imports/confirm', alice, confirm)).status, 409)
    assert.equal((await json('/api/private/imports/confirm', alice, confirm)).status, 201)
    assert.deepEqual(
      (await read('/api/sources', bob)).map((x: { id: unknown }) => x.id),
      [1, 'private:1'],
    )
    assert.match((await read('/api/questions', bob)).items[0].data.question, /^shared/)
    assert.match((await read('/api/private/questions', bob)).items[0].data.question, /^bob/)
    assert.match((await read('/api/private/questions', carol)).items[0].data.question, /^carol/)
    assert.equal((await read('/api/questions?search=missing&search=shared', bob)).total, 0)
    assert.equal((await read('/api/questions?sourceId=1&sourceId=0&page=1&page=0', bob)).total, 1)
    const catalog = await read('/api/private/concepts', bob)
    assert.equal(catalog.library.length, 1)
    assert.equal((await json('/api/private/concepts', bob, {})).status, 400)
    assert.equal(
      (await json('/api/private/concepts/' + '-'.repeat(36), bob, {}, 'PUT')).status,
      400,
    )
    const dismissed = await f.authorized(
      '/api/private/concept-suggestions/' + 'a'.repeat(64) + '/dismiss',
      bob,
      'POST',
    )
    assert.equal(dismissed.status, 409)
    assert.equal((await f.authorized('/api/private/questions/1', bob, 'DELETE')).status, 204)
    assert.equal((await read('/api/private/questions', bob)).total, 0)
    assert.equal((await read('/api/private/questions', carol)).total, 1)
    assert.equal((await read('/api/questions', bob)).total, 1)
    assert.equal((await f.authorized('/api/private/sources/1', carol, 'DELETE')).status, 204)
    assert.deepEqual(await read('/api/private/sources', carol), [])
  } finally {
    await f.close()
  }
})

test('concept create/update/removal and dismissal retain scoped JSON null responses', async () => {
  const f = await libraryFixture(undefined, [LibraryHttpModule])
  const cancellations: boolean[] = []
  const settle = StudyInputWork.prototype.settle
  const observation = mock.method(
    StudyInputWork.prototype,
    'settle',
    async function (this: StudyInputWork) {
      // A completed response can close before asynchronous resource work finishes.
      await setImmediate()
      cancellations.push(this.signal.aborted)
      return settle.call(this)
    },
  )
  try {
    const admin = await f.login('alice')
    const student = await f.login('bob')

    const json = (path: string, actor: string, input: unknown, method = 'POST') =>
      f.authorized(
        path,
        actor,
        method,
        { 'Content-Type': 'application/json' },
        JSON.stringify(input),
      )

    for (const prefix of ['/api', '/api/shared', '/api/private']) {
      const input = bank('concept-' + prefix)
      input.questions[0]!.question = prefix + ' first synthetic question?'
      input.questions[0]!.classification!.topic = prefix
      input.questions.push({
        ...structuredClone(input.questions[0]!),
        source_ref: '2',
        question: prefix + ' another synthetic question?',
      })
      const preview = await json(prefix + '/imports/preview', admin, { bank: input })
      const token = JSON.parse(preview.body).token
      assert.equal(
        (await json(prefix + '/imports/confirm', admin, { bank: input, token, reviewed: true }))
          .status,
        201,
      )
      const catalog = JSON.parse((await f.authorized(prefix + '/concepts', admin)).body)
      const candidate = catalog.suggestions[0]
      assert.ok(candidate)
      const body = { ...candidate, name: 'Reviewed concept' }
      const created = await json(prefix + '/concepts', admin, body)
      assert.equal(created.status, 201)
      const group = JSON.parse(created.body)
      assert.equal(
        (await json(prefix + '/concepts/' + group.id, admin, { ...body, name: 'Renamed' }, 'PUT'))
          .status,
        200,
      )
      if (prefix !== '/api/private') {
        for (const [path, method] of [
          ['concepts', 'POST'],
          ['concepts/' + group.id, 'PUT'],
          ['concepts/' + group.id, 'DELETE'],
          ['concept-suggestions/' + candidate.id + '/dismiss', 'POST'],
        ]) {
          assert.equal(
            (
              await f.authorized(
                prefix + '/' + path,
                student,
                method,
                { 'Content-Length': '1' },
                '{',
              )
            ).status,
            403,
          )
        }
      }
      const removed = await f.authorized(prefix + '/concepts/' + group.id, admin, 'DELETE')
      assert.equal(removed.status, 200)
      assert.equal(removed.body, 'null')
      const dismissed = await f.authorized(
        prefix + '/concept-suggestions/' + candidate.id + '/dismiss',
        admin,
        'POST',
      )
      assert.equal(dismissed.status, 200)
      assert.equal(dismissed.body, 'null')
    }
    await f.app.close()
    assert.ok(cancellations.length >= 6)
    assert.equal(
      cancellations.filter(Boolean).length,
      0,
      'Successful mutations must settle without cancellation',
    )
  } finally {
    await f.close()
    observation.mock.restore()
  }
})
