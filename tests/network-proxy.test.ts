import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { get } from 'node:https'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { prepareCertificates } from '../scripts/network-files.ts'

const image = 'caddy@sha256:36c24ad91a7ff7bc4c87fe22bfa8df3c4b18da0773d73fc12ee2c52b98c0bb7e'

/**
 * Exercise the actual proxy with trusted TLS and the requested hostname, through an ephemeral host port.
 */
function requestProxy(
  port: number,
  path: string,
  authority: Buffer,
  hostname: string,
): Promise<{ status: number; body: Buffer }> {
  return new Promise((resolveResponse, reject) => {
    const request = get(
      {
        hostname: '127.0.0.1',
        port,
        path,
        servername: hostname,
        ca: authority,
        headers: { Host: hostname },
      },
      (response) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => chunks.push(chunk))
        response.on('end', () =>
          resolveResponse({ status: response.statusCode ?? 0, body: Buffer.concat(chunks) }),
        )
        response.on('error', reject)
      },
    )
    request.on('error', reject)
    request.setTimeout(2000, () => request.destroy(new Error('Synthetic proxy request timed out')))
  })
}

/**
 * Run Docker only against the test's own container, with complete command failure evidence.
 */
function docker(arguments_: string[]): string {
  const result = spawnSync('docker', arguments_, { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  return result.stdout + (arguments_[0] === 'logs' ? result.stderr : '')
}

test('real TLS proxy trusts only its CA, blocks management paths and serves no private keys', async (testContext) => {
  const root = mkdtempSync(join(tmpdir(), 'study-network-proxy-'))
  const name = `study-network-test-${randomUUID()}`
  testContext.after(() => {
    spawnSync('docker', ['rm', '--force', name])
    rmSync(root, { recursive: true, force: true })
  })
  const profile = {
    hostname: 'study-proxy-test.local',
    address: '192.168.1.10',
    httpsPort: 3443,
    enrollmentPort: 3080,
    webPort: 3000,
    keycloakPort: 8080,
  }
  prepareCertificates(root, profile)
  writeFileSync(join(root, 'public/unrelated-private.txt'), 'synthetic must not be published')
  docker([
    'run',
    '-d',
    '--name',
    name,
    '--pull',
    'never',
    '--read-only',
    '--user',
    `${process.getuid!()}:${process.getgid!()}`,
    '--cap-drop',
    'ALL',
    '--cap-add',
    'NET_BIND_SERVICE',
    '--security-opt',
    'no-new-privileges',
    '--tmpfs',
    `/data:uid=${process.getuid!()},gid=${process.getgid!()},mode=0700`,
    '--tmpfs',
    `/config:uid=${process.getuid!()},gid=${process.getgid!()},mode=0700`,
    '--publish',
    '127.0.0.1::3443',
    '--publish',
    '127.0.0.1::3080',
    '--env',
    `STUDY_HTTPS_HOST=${profile.hostname}`,
    '--env',
    'STUDY_HTTPS_PORT=3443',
    '--env',
    'STUDY_CERTIFICATE_PORT=3080',
    '--env',
    'STUDY_KEYCLOAK_PORT=8080',
    '--mount',
    `type=bind,source=${resolve('dev/network/Caddyfile')},target=/etc/caddy/Caddyfile,readonly`,
    '--mount',
    `type=bind,source=${root}/tls,target=/certificates,readonly`,
    '--mount',
    `type=bind,source=${root}/public,target=/public,readonly`,
    image,
  ])
  assert.equal(
    docker(['inspect', '--format', '{{.State.Running}}', name]).trim(),
    'true',
    docker(['logs', name]),
  )
  const tlsPort = Number(docker(['port', name, '3443/tcp']).trim().split(':').at(-1))
  const publicPort = Number(docker(['port', name, '3080/tcp']).trim().split(':').at(-1))
  const authority = readFileSync(join(root, 'public/root.crt'))
  let ready = false
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await requestProxy(tlsPort, '/admin/', authority, profile.hostname)
      assert.equal(response.status, 404)
      ready = true
      break
    } catch {
      await delay(100)
    }
  }
  assert.equal(ready, true, docker(['logs', name]))
  await assert.rejects(
    requestProxy(tlsPort, '/admin/', authority, 'wrong.local'),
    /certificate|TLS|socket|alert/i,
  )
  const certificate = await fetch(`http://127.0.0.1:${publicPort}/root.crt`)
  assert.equal(certificate.status, 200)
  assert.deepEqual(Buffer.from(await certificate.arrayBuffer()), authority)
  assert.equal(certificate.headers.get('Content-Type'), 'application/x-x509-ca-cert')
  for (const path of [
    '/root.key',
    '/site.key',
    '/authority/root.key',
    '/unrelated-private.txt',
    '/api/health',
  ]) {
    const response = await fetch(`http://127.0.0.1:${publicPort}${path}`)
    assert.equal(response.status, 404)
  }
  const administration = await requestProxy(
    tlsPort,
    '/realms/master/.well-known/openid-configuration',
    authority,
    profile.hostname,
  )
  assert.equal(administration.status, 404)
})
