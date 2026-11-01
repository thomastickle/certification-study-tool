import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import {
  publishedPorts,
  validateProfile,
  networkOrigin,
  renderNetworkCompose,
} from '../scripts/network-profile.ts'

const profile = {
  hostname: 'study-laptop.local',
  address: '192.168.1.125',
  httpsPort: 3443,
  enrollmentPort: 3080,
  webPort: 3000,
  keycloakPort: 8080,
}

test('local mode publishes only loopback; LAN mode adds only the selected home address', () => {
  const local = publishedPorts('local', profile)
  assert.equal(local.length, 4)
  assert.ok(local.every((port) => port.startsWith('127.0.0.1:')))
  assert.deepEqual(publishedPorts('lan', profile), [
    ...local,
    '192.168.1.125:3443:3443',
    '192.168.1.125:3080:3080',
  ])
})

for (const address of ['0.0.0.0', '127.0.0.1', '8.8.8.8', '192.168.1.999', '::']) {
  test(`network configuration rejects unsafe listener ${address}`, () => {
    assert.throws(() => validateProfile({ ...profile, address }), /private IPv4/)
  })
}

test('configuration rejects injected names and duplicate ports while keeping the origin fixed', () => {
  assert.throws(() => validateProfile({ ...profile, hostname: 'bad.local\n:80' }), /local name/)
  assert.throws(() => validateProfile({ ...profile, enrollmentPort: 3443 }), /distinct/)
  assert.equal(networkOrigin(profile), 'https://study-laptop.local:3443')
  const paths = {
    root: '/private/network',
    proxyConfiguration: '/app/dev/network/Caddyfile',
    image: 'caddy:2',
  }
  for (const mode of ['local', 'lan'] as const) {
    const compose = renderNetworkCompose(mode, profile, paths)
    assert.ok(compose.includes('STUDY_OIDC_ISSUER: "https://study-laptop.local:3443/realms/study"'))
    assert.ok(compose.includes('NODE_EXTRA_CA_CERTS: /trust/root.crt'))
    assert.ok(!compose.includes('NODE_TLS_REJECT_UNAUTHORIZED'))
    assert.ok(!compose.includes('/authority'))
  }
})

test('real Compose merging replaces port publications and retains the selected data volume in both modes', (testContext) => {
  const root = mkdtempSync(join(tmpdir(), 'study-network-compose-'))
  testContext.after(() => rmSync(root, { recursive: true, force: true }))
  const selection = join(root, 'volume.yaml')
  writeFileSync(
    selection,
    'volumes:\n  study-data:\n    external: true\n    name: synthetic-existing-study-data\n',
  )
  const path = join(root, 'access.yaml')
  const paths = { root, proxyConfiguration: resolve('dev/network/Caddyfile'), image: 'caddy:2' }
  for (const mode of ['local', 'lan'] as const) {
    writeFileSync(path, renderNetworkCompose(mode, profile, paths))
    const result = spawnSync(
      'docker',
      [
        'compose',
        '--env-file',
        '/dev/null',
        '--file',
        resolve('compose.yaml'),
        '--file',
        selection,
        '--file',
        path,
        'config',
        '--format',
        'json',
      ],
      {
        env: { ...process.env, KC_BOOTSTRAP_ADMIN_PASSWORD: 'synthetic', COMPOSE_FILE: '' },
        encoding: 'utf8',
      },
    )
    assert.equal(result.status, 0, result.stderr)
    const configuration = JSON.parse(result.stdout)
    assert.equal(configuration.volumes['study-data'].name, 'synthetic-existing-study-data')
    const publications = configuration.services.keycloak.ports
    assert.equal(publications.length, mode === 'local' ? 4 : 6)
    for (const publication of publications) {
      if (publication.target === 3000 || publication.target === 8080) {
        assert.equal(publication.host_ip, '127.0.0.1')
      } else {
        assert.ok(['127.0.0.1', profile.address].includes(publication.host_ip))
      }
    }
    assert.equal(
      configuration.services.study.environment.STUDY_OIDC_ISSUER,
      `${networkOrigin(profile)}/realms/study`,
    )
    assert.equal(configuration.services.proxy.network_mode, 'service:keycloak')
  }
})
