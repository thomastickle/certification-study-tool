import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { apiController } from '../src/server/http-controller.ts'
import { LibraryRepository } from '../src/server/questions/library-repository.ts'
import { ImportService } from '../src/server/importer/import-service.ts'
import { HomeService } from '../src/server/home/home-service.ts'
import { bank } from './fixtures.ts'

test('HTTP home and earned settings preserve readiness, enforce scope and survive restart/deletion', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'study-home-'))
  const database = join(directory, 'test.sqlite3')
  const repository = new LibraryRepository(database)
  const importer = new ImportService(repository)
  const input = bank()
  input.certification = { provider: 'AWS', code: 'CLF-C02', name: 'Cloud Practitioner' }
  importer.confirm(input, importer.preview(input).token, false)
  const revision = repository.revision()
  const server = createServer(apiController(repository, { id: 'local', role: 'admin' }))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const base = `http://127.0.0.1:${address.port}`

  async function earned(data: unknown, origin = base) {
    return fetch(base + '/api/certifications/earned', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify(data),
    })
  }

  try {
    const response = await fetch(base + '/api/home')
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    const initial = await response.json()
    const scope = { provider: 'AWS', code: 'CLF-C02', earned: true }
    assert.equal((await earned(scope, 'https://untrusted.example')).status, 403)
    assert.equal((await earned({ ...scope, earned: 'true' })).status, 400)
    assert.equal((await earned({ ...scope, code: 'NOT-TRACKED' })).status, 404)
    const markedResponse = await earned(scope)
    assert.equal(markedResponse.status, 200)
    const marked = await markedResponse.json()
    assert.equal(marked.providers[0].certifications[0].earned, true)
    assert.deepEqual(
      marked.providers[0].certifications[0].readiness,
      initial.providers[0].certifications[0].readiness,
    )
    assert.equal(marked.providers[0].ready, 0, 'earned is independent of exam-ready')
    assert.equal(repository.revision(), revision, 'earned settings do not invalidate bank previews')
    assert.equal((await earned(scope)).status, 200, 'setting earned is idempotent')
    repository.deleteSource(repository.sources()[0]!.id)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    repository.close()
  }
  const reopened = new LibraryRepository(database)
  try {
    const service = new HomeService(reopened)
    assert.equal(service.get().providers[0]!.certifications[0]!.earned, true)
    service.setEarned({ provider: 'AWS', code: 'CLF-C02', earned: false })
    assert.deepEqual(
      service.get().providers,
      [],
      'removing an earned-only track leaves no invented catalog entry',
    )
  } finally {
    reopened.close()
    rmSync(directory, { recursive: true })
  }
})
