import assert from 'node:assert/strict'
import { resolve, join } from 'node:path'
import { test } from 'node:test'
import { runtimeConfiguration } from '../src/server/runtime/runtime-configuration.ts'

test('explicit environment derives isolated paths without reading the ambient environment', () => {
  const configuration = runtimeConfiguration({
    STUDY_DB_PATH: '/tmp/synthetic-config/library.sqlite3',
  })
  assert.equal(configuration.authentication.accountsPath, '/tmp/synthetic-config/accounts.sqlite3')
  assert.equal(configuration.privateLibrariesDirectory, '/tmp/synthetic-config/users')
  assert.equal(configuration.host, '127.0.0.1')
  assert.equal(configuration.port, 3000)
  assert.equal(configuration.origin.origin, 'http://127.0.0.1:3000')
  assert.equal(configuration.authentication.issuer, 'http://127.0.0.1:8080/realms/study')
  assert.equal(configuration.authentication.clientId, 'study-tool')
  assert.equal(configuration.authentication.clientSecret, undefined)
  assert.equal(configuration.production, false)
  assert.equal(runtimeConfiguration({}).databasePath, resolve('private/app/library.sqlite3'))
})

test('configuration preserves explicit OIDC, owner and production settings and rejects invalid paths/ports', () => {
  const configuration = runtimeConfiguration({
    STUDY_PORT: '4100',
    STUDY_HOST: '0.0.0.0',
    STUDY_ORIGIN: 'https://study.example.test',
    STUDY_OIDC_ISSUER: 'https://login.example.test',
    STUDY_OIDC_CLIENT_ID: 'fixture',
    STUDY_OIDC_CLIENT_SECRET: 'synthetic',
    STUDY_LEGACY_OWNER_SUBJECT: 'owner',
    STUDY_PRIVATE_LIBRARIES_DIR: '/tmp/config-users',
    NODE_ENV: 'production',
  })
  assert.equal(configuration.origin.origin, 'https://study.example.test')
  assert.equal(configuration.authentication.origin, configuration.origin)
  assert.equal(configuration.authentication.clientId, 'fixture')
  assert.equal(configuration.authentication.clientSecret, 'synthetic')
  assert.equal(configuration.legacyOwnerSubject, 'owner')
  assert.equal(configuration.privateLibrariesDirectory, '/tmp/config-users')
  assert.equal(configuration.production, true)
  for (const port of ['0', '-1', '65536', '1.1', 'NaN', '']) {
    assert.throws(() => runtimeConfiguration({ STUDY_PORT: port }), /valid port/)
  }
  assert.throws(
    () =>
      runtimeConfiguration({
        STUDY_DB_PATH: '/tmp/same',
        STUDY_ACCOUNTS_PATH: join('/tmp', 'same'),
      }),
    /separate/,
  )
})

test('configuration validates OIDC transport and origin before any provider can acquire files', () => {
  for (const environment of [
    { STUDY_ORIGIN: 'https://study.example.test/path' },
    { STUDY_ORIGIN: 'http://study.example.test' },
    { STUDY_OIDC_ISSUER: 'http://login.example.test' },
    { STUDY_OIDC_CLIENT_ID: '   ' },
  ]) {
    assert.throws(() => runtimeConfiguration(environment))
  }
})
