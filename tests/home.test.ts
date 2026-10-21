import assert from 'node:assert/strict'
import { test } from 'node:test'
import { HomeService } from '../src/server/home/home-service.ts'
import { ImportService } from '../src/server/importer/import-service.ts'
import { LibraryRepository } from '../src/server/questions/library-repository.ts'
import { bank } from './fixtures.ts'

test('home groups real library certifications by provider, not one track per bank', () => {
  const repository = new LibraryRepository(':memory:')
  try {
    const importer = new ImportService(repository)
    for (const [key, provider, code, name] of [
      ['aws-one', 'AWS', 'CLF-C02', 'Cloud Practitioner'],
      ['aws-two', 'AWS', 'CLF-C02', 'Cloud Practitioner'],
      ['aws-other', 'AWS', 'OTHER-1', 'Another track'],
      ['example', 'Example', 'DEMO-1', 'Example track'],
    ]) {
      const input = bank(key)
      input.certification = { provider: provider!, code: code!, name: name! }
      importer.confirm(input, importer.preview(input).token, false)
    }
    const home = new HomeService(repository).get()
    assert.deepEqual(
      home.providers.map((provider) => [provider.name, provider.total]),
      [
        ['AWS', 2],
        ['Example', 1],
      ],
    )
    const aws = home.providers[0]!
    assert.equal(aws.ready, 0)
    assert.equal(aws.certifications[0]!.sourceIds.length, 2)
    assert.equal(aws.certifications[0]!.readiness.status, 'insufficient')
    assert.equal(aws.certifications[1]!.readiness.status, 'unsupported')
    assert.equal(aws.certifications[1]!.readiness.score, null)
    assert.doesNotMatch(JSON.stringify(home), /Which option|Example A|fingerprint|mastery:v1/)
  } finally {
    repository.close()
  }
})
