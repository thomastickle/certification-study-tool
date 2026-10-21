import test from 'node:test'
import assert from 'node:assert/strict'
import {
  certificationKey,
  certificationsFromSources,
  filterCertifications,
} from './certifications.ts'
import type { Source } from '../shared/contracts.ts'

/** Builds an eligible imported source with explicit scenario overrides. */
function source(overrides: Partial<Source> = {}): Source {
  return {
    id: 1,
    name: 'Official bank',
    kind: 'official',
    key: 'aws-clf',
    certification: 'CLF-C02',
    certificationName: 'AWS Certified Cloud Practitioner',
    provider: 'Amazon Web Services',
    questionCount: 4,
    ...overrides,
  }
}

test('catalog includes positive official and third party sources once per provider and code', () => {
  const certs = certificationsFromSources([
    source(),
    source({ id: 2, kind: 'third_party', certificationName: 'Duplicate bank' }),
    source({
      id: 3,
      provider: 'AWS',
      certification: 'SAA-C03',
      certificationName: 'Solutions Architect Associate',
    }),
    source({ id: 4, kind: 'personal' }),
    source({ id: 5, questionCount: 0 }),
  ])

  assert.equal(certs.length, 2)
  assert.equal(certs[0]?.provider, 'Amazon Web Services')
  assert.equal(certs[0]?.level, 'Foundational')
  assert.equal(certs[1]?.level, 'Associate')
  assert.equal(certificationKey(certs[0]!), '["Amazon Web Services","CLF-C02"]')
})

test('known Azure, Google Cloud and Microsoft certifications carry normalized organization and platform', () => {
  const certs = certificationsFromSources([
    source({
      provider: 'microsoft',
      certification: 'AZ-900',
      certificationName: 'Azure Fundamentals',
    }),
    source({ provider: 'GCP', certification: 'CDL', certificationName: 'Cloud Digital Leader' }),
    source({
      provider: 'Microsoft 365',
      certification: 'MS-900',
      certificationName: 'Microsoft 365 Fundamentals',
    }),
    source({
      provider: 'Microsoft Power Platform',
      certification: 'PL-900',
      certificationName: 'Power Platform Fundamentals',
    }),
  ])

  assert.deepEqual(
    certs.map(({ code, organization, platform, level }) => [code, organization, platform, level]),
    [
      ['CDL', 'Google Cloud', 'Google Cloud', 'Foundational'],
      ['AZ-900', 'Microsoft', 'Azure', 'Fundamentals'],
      ['MS-900', 'Microsoft', 'Microsoft 365', 'Fundamentals'],
      ['PL-900', 'Microsoft', 'Power Platform', 'Fundamentals'],
    ],
  )
})

test('unknown certifications remain visible without an inferred level', () => {
  const [cert] = certificationsFromSources([
    source({
      provider: 'Some Cloud',
      certification: 'XYZ-123',
      certificationName: 'Advanced Widget Expert',
    }),
  ])!

  assert.equal(cert?.level, null)
})

test('full platform names support short provider aliases without losing their namespace', () => {
  const certs = certificationsFromSources([
    source({
      provider: 'Microsoft Azure',
      certification: 'AZ-900',
      certificationName: 'Azure Fundamentals',
    }),
    source({ provider: 'Google', certification: 'CDL', certificationName: 'Cloud Digital Leader' }),
    source({
      provider: 'Microsoft 365',
      certification: 'MS-900',
      certificationName: 'Microsoft 365 Fundamentals',
    }),
  ])
  assert.equal(filterCertifications(certs, 'ms azure')[0]?.provider, 'Microsoft Azure')
  assert.equal(filterCertifications(certs, 'gcp')[0]?.provider, 'Google')
  assert.equal(filterCertifications(certs, 'ms 365')[0]?.provider, 'Microsoft 365')
})

test('search uses case insensitive partial tokens across metadata and requires every token', () => {
  const [aws, azure] = certificationsFromSources([
    source(),
    source({
      id: 2,
      provider: 'Microsoft',
      certification: 'AZ-900',
      certificationName: 'Azure Fundamentals',
    }),
  ])!

  assert.deepEqual(filterCertifications([aws!, azure!], 'AMAZON clf'), [aws])
  assert.deepEqual(filterCertifications([aws!, azure!], 'amazon azure'), [])
  assert.deepEqual(filterCertifications([aws!, azure!], 'web services'), [aws])
})

test('raw backend namespaces and codes survive metadata normalization without alias deduplication', () => {
  const certs = certificationsFromSources([
    source({ provider: 'AWS' }),
    source({ provider: 'Amazon Web Services' }),
    source({ provider: 'Azure', certification: ' AZ-900 ' }),
    source({ provider: 'Microsoft', certification: ' AZ-900 ' }),
  ])

  assert.equal(certs.length, 4)
  assert.deepEqual(
    new Set(certs.map(certificationKey)),
    new Set([
      '["AWS","CLF-C02"]',
      '["Amazon Web Services","CLF-C02"]',
      '["Azure"," AZ-900 "]',
      '["Microsoft"," AZ-900 "]',
    ]),
  )
  assert.equal(certs.find((cert) => cert.provider === 'AWS')?.organization, 'Amazon Web Services')
  assert.equal(certs.find((cert) => cert.provider === 'Azure')?.platform, 'Azure')
})
