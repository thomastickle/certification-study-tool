import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
  symlinkSync,
  existsSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  enableNetworkCompose,
  hasLocalHostname,
  prepareCertificates,
  writeHostSetup,
} from '../scripts/network-files.ts'

const profile = {
  hostname: 'study-test.local',
  address: '192.168.1.10',
  httpsPort: 3443,
  enrollmentPort: 3080,
  webPort: 3000,
  keycloakPort: 8080,
}

test('mode prerequisites require an unambiguous loopback hosts entry', () => {
  assert.equal(hasLocalHostname('127.0.0.1 study-test.local # owned\n', profile.hostname), true)
  assert.equal(hasLocalHostname('127.0.0.1 localhost # study-test.local', profile.hostname), false)
  assert.equal(hasLocalHostname('192.168.1.10 study-test.local', profile.hostname), false)
  assert.equal(
    hasLocalHostname('192.168.1.10 study-test.local\n127.0.0.1 study-test.local', profile.hostname),
    false,
  )
})

test('selecting the network override preserves private environment settings and existing volume configuration', (testContext) => {
  const root = mkdtempSync(join(tmpdir(), 'study-network-env-'))
  testContext.after(() => rmSync(root, { recursive: true, force: true }))
  const path = join(root, '.env')
  writeFileSync(
    path,
    'KC_BOOTSTRAP_ADMIN_PASSWORD=synthetic-value\nCOMPOSE_FILE=compose.yaml:private/volume.yaml\n',
  )
  enableNetworkCompose(path, ['compose.yaml', 'private/volume.yaml', 'private/access.yaml'])
  assert.equal(
    readFileSync(path, 'utf8'),
    'KC_BOOTSTRAP_ADMIN_PASSWORD=synthetic-value\nCOMPOSE_FILE=compose.yaml:private/volume.yaml:private/access.yaml\n',
  )
  assert.equal(statSync(path).mode & 0o777, 0o600)
})

test('certificate renewal preserves the trusted CA, validates the selected name, and separates private keys from enrollment files', (testContext) => {
  const root = mkdtempSync(join(tmpdir(), 'study-network-cert-'))
  testContext.after(() => rmSync(root, { recursive: true, force: true }))
  prepareCertificates(root, profile)
  const authority = readFileSync(join(root, 'public/root.crt'))
  const key = readFileSync(join(root, 'authority/root.key'))
  prepareCertificates(root, profile)
  assert.deepEqual(readFileSync(join(root, 'public/root.crt')), authority)
  assert.deepEqual(readFileSync(join(root, 'authority/root.key')), key)
  for (const path of ['authority/root.key', 'tls/site.key']) {
    assert.equal(statSync(join(root, path)).mode & 0o777, 0o600)
  }
  const verified = spawnSync('openssl', [
    'verify',
    '-CAfile',
    join(root, 'public/root.crt'),
    '-verify_hostname',
    profile.hostname,
    join(root, 'tls/site.crt'),
  ])
  assert.equal(verified.status, 0)
  const wrongName = spawnSync('openssl', [
    'verify',
    '-CAfile',
    join(root, 'public/root.crt'),
    '-verify_hostname',
    'wrong.local',
    join(root, 'tls/site.crt'),
  ])
  assert.notEqual(wrongName.status, 0)
  const page = readFileSync(join(root, 'public/index.html'), 'utf8')
  assert.ok(page.includes('Certificate Trust Settings'))
  assert.ok(page.includes('https://study-test.local:3443'))
  writeHostSetup(root, profile)
  assert.equal(spawnSync('sh', ['-n', join(root, 'host-setup.sh')]).status, 0)
  assert.ok(readFileSync(join(root, 'host-setup.sh'), 'utf8').includes('conflict'))
})

test('certificate preparation rejects linked authority directories and dangling key links before OpenSSL writes', (testContext) => {
  const root = mkdtempSync(join(tmpdir(), 'study-network-linked-cert-'))
  testContext.after(() => rmSync(root, { recursive: true, force: true }))
  const deployment = join(root, 'network')
  const outside = join(root, 'outside')
  mkdirSync(deployment)
  mkdirSync(outside, { mode: 0o755 })
  const originalMode = statSync(outside).mode
  symlinkSync(outside, join(deployment, 'authority'))
  assert.throws(() => prepareCertificates(deployment, profile), /links/i)
  assert.equal(statSync(outside).mode, originalMode)
  rmSync(join(deployment, 'authority'))
  mkdirSync(join(deployment, 'authority'))
  const target = join(outside, 'unowned.key')
  symlinkSync(target, join(deployment, 'authority/root.key'))
  assert.throws(() => prepareCertificates(deployment, profile), /links/i)
  assert.equal(existsSync(target), false)
})
