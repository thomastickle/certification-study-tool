import { spawnSync } from 'node:child_process'
import {
  appendFileSync,
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { networkInterfaces } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseEnv } from 'node:util'
import {
  enableNetworkCompose,
  hasLocalHostname,
  prepareCertificates,
  writeHostSetup,
  writePrivate,
} from './network-files.ts'
import { configureKeycloak } from './network-keycloak.ts'
import { startAdvertisement, stopAdvertisement } from './network-publisher.ts'
import { networkOrigin, renderNetworkCompose, validateProfile } from './network-profile.ts'
import type { AccessMode, NetworkProfile } from './network-profile.ts'

const repository = fileURLToPath(new URL('../', import.meta.url))
const directory = join(repository, 'private/network-access')
const statePath = join(directory, 'state.json')
const composePath = join(directory, 'access.compose.yaml')
const logPath = join(directory, 'operations.log')
const proxyImage = 'caddy@sha256:36c24ad91a7ff7bc4c87fe22bfa8df3c4b18da0773d73fc12ee2c52b98c0bb7e'

type ComposeConfiguration = {
  name: string
  services: {
    keycloak: { volumes: { type: string; source: string; target: string }[] }
    study: {
      image: string
      environment: Record<string, string>
      volumes: { type: string; source: string; target: string }[]
    }
  }
  volumes: Record<string, { name: string }>
}

type AccessState = {
  profile: NetworkProfile
  mode: AccessMode
  baseFiles: string[]
  previousIssuer: string
  initialized: boolean
  projectName?: string
  studyVolume?: string
  keycloakVolume?: string
}

/**
 * Execute local tools with private diagnostics and no shell interpolation.
 * @throws {Error} On tool failure; the error identifies the restricted diagnostic log only.
 */
function run(command: string, arguments_: string[], logOutput = true): string {
  const result = spawnSync(command, arguments_, {
    cwd: repository,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  })
  if (logOutput || result.status !== 0) {
    appendFileSync(
      logPath,
      `${command} ${arguments_[0] ?? ''}\n${result.stdout ?? ''}${result.stderr ?? ''}\n`,
      { mode: 0o600 },
    )
  }
  if (result.error || result.status !== 0) {
    throw new Error(`${command} failed; see ${logPath}.`)
  }
  return result.stdout
}

/**
 * Select the route's physical interface, excluding Docker, VM and VPN interfaces.
 * @throws {Error} If the selected address does not belong to a physical home-network interface.
 */
function lanAddress(requested?: string): string {
  const interfaces = networkInterfaces()
  const eligible = Object.entries(interfaces).filter(([name]) => /^(en|eth|wl)/.test(name))
  const addresses = eligible.flatMap(
    ([, entries]) =>
      entries
        ?.filter((entry) => entry.family === 'IPv4' && !entry.internal)
        .map((entry) => entry.address) ?? [],
  )
  if (requested) {
    if (!addresses.includes(requested)) {
      throw new Error(
        'The selected LAN address is not assigned to a physical Ethernet/Wi-Fi interface.',
      )
    }
    return requested
  }
  const routes = JSON.parse(run('ip', ['-j', '-4', 'route', 'show', 'default'], false)) as {
    dev: string
    metric?: number
  }[]
  const preferred = routes
    .sort((first, second) => (first.metric ?? 0) - (second.metric ?? 0))
    .find((route) => eligible.some(([name]) => name === route.dev))
  const address =
    preferred &&
    interfaces[preferred.dev]?.find((entry) => entry.family === 'IPv4' && !entry.internal)?.address
  if (!address) {
    throw new Error('No physical home-network route found. Select --address explicitly.')
  }
  return address
}

/**
 * Resolve Compose with explicit files so the currently selected data-volume override is retained.
 */
function composeArguments(state: AccessState, includeAccess = true): string[] {
  const files = includeAccess ? [...state.baseFiles, composePath] : state.baseFiles
  return [
    'compose',
    ...(state.projectName ? ['--project-name', state.projectName] : []),
    '--project-directory',
    repository,
    ...files.flatMap((file) => ['--file', resolve(repository, file)]),
  ]
}

/**
 * Load trusted local state without printing credentials from the environment or resolved Compose model.
 */
function configuration(state: AccessState): ComposeConfiguration {
  return JSON.parse(
    run('docker', [...composeArguments(state, false), 'config', '--format', 'json'], false),
  ) as ComposeConfiguration
}

/**
 * Render a profile that keeps private volume mounts and the HTTPS authority outside the image.
 */
function writeProfile(state: AccessState): void {
  const paths = {
    root: directory,
    proxyConfiguration: join(repository, 'dev/network/Caddyfile'),
    image: proxyImage,
    user: `${process.getuid!()}:${process.getgid!()}`,
  }
  writePrivate(composePath, renderNetworkCompose(state.mode, state.profile, paths))
  writePrivate(statePath, `${JSON.stringify(state, null, 2)}\n`)
}

/**
 * Stop the existing writers before the one-time identity cutover, retaining a verified central backup.
 * @throws {Error} For unsupported mounts or a gated cutover; the app stays stopped on failure.
 */
function adoptIdentity(state: AccessState): void {
  const model = configuration(state)
  const installed = model.services.study
  const storage = installed.volumes.find((volume) => volume.target === '/data')
  const central = installed.environment.STUDY_DB_PATH ?? '/data/central.sqlite3'
  if (storage?.type !== 'volume' || central !== '/data/central.sqlite3') {
    throw new Error(
      'Network setup currently requires the documented named /data volume and central.sqlite3.',
    )
  }
  const volumeName = model.volumes[storage.source]?.name
  if (!volumeName) {
    throw new Error('Cannot resolve the existing managed data volume.')
  }
  run('docker', ['volume', 'inspect', volumeName], false)
  run('docker', [
    'run',
    '--rm',
    '--pull',
    'never',
    '--network',
    'none',
    '--user',
    'node',
    '--mount',
    `type=volume,source=${volumeName},target=/data`,
    '--mount',
    `type=bind,source=${join(repository, 'scripts')},target=/workspace/scripts,readonly`,
    '--mount',
    `type=bind,source=${join(repository, 'database')},target=/workspace/database,readonly`,
    '--mount',
    `type=bind,source=${join(repository, 'package.json')},target=/workspace/package.json,readonly`,
    '--entrypoint',
    'node',
    installed.image,
    '/workspace/scripts/network-identity.ts',
    '/data/central.sqlite3',
    state.previousIssuer,
    `${networkOrigin(state.profile)}/realms/study`,
    '--offline',
  ])
}

/**
 * Check the real HTTPS path from the application namespace with its configured CA trust.
 */
function verifyHttps(state: AccessState): void {
  const probe = `
    import assert from 'node:assert/strict'
    const origin = process.argv[1]
    const health = await fetch(origin + '/api/health', { redirect: 'error' })
    assert.equal(health.status, 200)
    const discovery = await fetch(origin + '/realms/study/.well-known/openid-configuration', { redirect: 'error' })
    assert.equal(discovery.status, 200)
    const metadata = await discovery.json()
    assert.equal(metadata.issuer, origin + '/realms/study')
    const login = await fetch(origin + '/auth/login', { redirect: 'manual' })
    assert.equal(login.status, 302)
    const destination = new URL(login.headers.get('location'))
    assert.equal(destination.origin, origin)
    assert.equal(destination.pathname, '/realms/study/protocol/openid-connect/auth')
    assert.ok(login.headers.get('set-cookie')?.includes('Secure'))
  `
  run('docker', [
    ...composeArguments(state),
    'exec',
    '-T',
    'study',
    'node',
    '--input-type=module',
    '-e',
    probe,
    networkOrigin(state.profile),
  ])
}

/**
 * Apply local/LAN listeners with explicit stop/recreate ordering for the shared network namespace.
 * @throws {Error} On failed setup/startup; stop the application so partially applied settings cannot create accounts.
 */
async function apply(
  state: AccessState,
  environment: Record<string, string>,
  setup: boolean,
): Promise<void> {
  if (
    state.mode === 'local' &&
    !hasLocalHostname(readFileSync('/etc/hosts', 'utf8'), state.profile.hostname)
  ) {
    throw new Error(
      `First run: sudo sh ${join(directory, 'host-setup.sh')}. This one-time step enables local-only hostname resolution.`,
    )
  }
  if (state.mode === 'lan') {
    lanAddress(state.profile.address)
  }
  const model = configuration(state)
  const studyMount = model.services.study.volumes.find((volume) => volume.target === '/data')
  const identityMount = model.services.keycloak.volumes.find(
    (volume) => volume.target === '/opt/keycloak/data',
  )
  const studyVolume = studyMount && model.volumes[studyMount.source]?.name
  const keycloakVolume = identityMount && model.volumes[identityMount.source]?.name
  if (
    !studyVolume ||
    !keycloakVolume ||
    studyVolume !== state.studyVolume ||
    keycloakVolume !== state.keycloakVolume
  ) {
    throw new Error(
      'The selected application/Keycloak volumes changed. Refusing an identity cutover or mode switch against another deployment.',
    )
  }
  run('docker', ['volume', 'inspect', studyVolume, keycloakVolume], false)
  writeProfile(state)
  const compose = composeArguments(state)
  run('docker', [...compose, 'stop', 'study', 'proxy', 'keycloak'])
  stopAdvertisement(directory)
  try {
    if (setup) {
      adoptIdentity(state)
      const environmentBackup = join(directory, 'environment-before-network')
      if (!existsSync(environmentBackup)) {
        writePrivate(environmentBackup, readFileSync(join(repository, '.env'), 'utf8'))
      }
      enableNetworkCompose(join(repository, '.env'), [...state.baseFiles, composePath])
      run('docker', [
        ...compose,
        'up',
        '-d',
        '--pull',
        'never',
        '--force-recreate',
        '--wait',
        '--wait-timeout',
        '180',
        'keycloak',
        'proxy',
      ])
      await configureKeycloak(state.profile, environment, directory)
      state.initialized = true
    }
    if (state.mode === 'lan') {
      await startAdvertisement(directory, state.profile)
    }
    run('docker', [
      ...compose,
      'up',
      '-d',
      '--pull',
      'never',
      '--force-recreate',
      '--wait',
      '--wait-timeout',
      '180',
      'keycloak',
      'proxy',
      'study',
    ])
    verifyHttps(state)
    writeProfile(state)
  } catch (error) {
    run('docker', [...compose, 'stop', 'study'])
    stopAdvertisement(directory)
    throw error
  }
}

/**
 * Show the selected mode and public trust fingerprint, never keys or administrator credentials.
 */
function printAccess(state: AccessState): void {
  console.log(`Mode: ${state.mode}\nStudy: ${networkOrigin(state.profile)}`)
  if (state.mode === 'lan') {
    console.log(`Phone setup: http://${state.profile.address}:${state.profile.enrollmentPort}`)
  }
  console.log(
    run(
      'openssl',
      ['x509', '-in', join(directory, 'public/root.crt'), '-noout', '-sha256', '-fingerprint'],
      false,
    ).trim(),
  )
  if (!hasLocalHostname(readFileSync('/etc/hosts', 'utf8'), state.profile.hostname)) {
    console.log(`One-time laptop setup: sudo sh ${join(directory, 'host-setup.sh')}`)
  }
}

/**
 * Operate the existing local Docker deployment without changing runtime authorization or TLS validation.
 * @throws {Error} For incomplete setup, invalid arguments or unavailable local tooling.
 */
async function main(): Promise<void> {
  if (process.getuid!() === 0) {
    throw new Error(
      'Run access commands as your ordinary Docker-enabled user; only host-setup.sh needs sudo.',
    )
  }
  process.umask(0o077)
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  chmodSync(directory, 0o700)
  const lockPath = join(directory, 'operation.lock')
  const lock = openSync(lockPath, 'wx', 0o600)
  writeFileSync(lock, JSON.stringify({ pid: process.pid }))
  try {
    const [command, ...arguments_] = process.argv.slice(2)
    let allowed: string[] = []
    if (command === 'setup') {
      allowed = ['--hostname', '--address']
    } else if (command === 'lan') {
      allowed = ['--address']
    }
    const seen = new Set<string>()
    for (let index = 0; index < arguments_.length; index += 2) {
      const flag = arguments_[index]!
      if (
        !allowed.includes(flag) ||
        seen.has(flag) ||
        !arguments_[index + 1] ||
        arguments_[index + 1]!.startsWith('--')
      ) {
        throw new Error(
          'Use only the documented --hostname and --address options, each with one value.',
        )
      }
      seen.add(flag)
    }
    const environment = {
      ...parseEnv(readFileSync(join(repository, '.env'), 'utf8')),
      ...process.env,
    } as Record<string, string>

    /**
     * Read a named CLI option without interpreting it as shell text.
     */
    const option = (name: string): string | undefined => {
      const index = arguments_.indexOf(name)
      if (index === -1) {
        return undefined
      }
      const value = arguments_[index + 1]
      if (!value || value.startsWith('--')) {
        throw new Error(`Missing value for ${name}.`)
      }
      return value
    }

    let state: AccessState
    if (existsSync(statePath)) {
      state = JSON.parse(readFileSync(statePath, 'utf8')) as AccessState
    } else {
      if (command !== 'setup') {
        throw new Error('First run npm run access:setup -- --hostname study-laptop.local.')
      }
      const baseFiles = (environment.COMPOSE_FILE ?? 'compose.yaml').split(':')
      if (baseFiles.some((file) => resolve(repository, file) === composePath)) {
        throw new Error(
          'Existing network state is missing. Restore state.json or the saved environment before setting up again.',
        )
      }
      const profile: NetworkProfile = {
        hostname: option('--hostname') ?? 'study-laptop.local',
        address: lanAddress(option('--address')),
        httpsPort: 3443,
        enrollmentPort: 3080,
        webPort: Number(environment.STUDY_WEB_PORT ?? 3000),
        keycloakPort: Number(environment.STUDY_KEYCLOAK_PORT ?? 8080),
      }
      state = { profile, baseFiles, mode: 'lan', previousIssuer: '', initialized: false }
      const model = configuration(state)
      state.projectName = model.name
      state.previousIssuer =
        model.services.study.environment.STUDY_OIDC_ISSUER ??
        `http://127.0.0.1:${profile.keycloakPort}/realms/study`
      const studyMount = model.services.study.volumes.find((volume) => volume.target === '/data')
      const identityMount = model.services.keycloak.volumes.find(
        (volume) => volume.target === '/opt/keycloak/data',
      )
      state.studyVolume = studyMount && model.volumes[studyMount.source]?.name
      state.keycloakVolume = identityMount && model.volumes[identityMount.source]?.name
    }
    validateProfile(state.profile)
    const localIssuer = `http://127.0.0.1:${state.profile.keycloakPort}/realms/study`
    const httpsIssuer = `${networkOrigin(state.profile)}/realms/study`
    if (![localIssuer, httpsIssuer].includes(state.previousIssuer)) {
      throw new Error(
        'Automatic adoption is restricted to this local Keycloak realm. External identity providers require a separate reviewed migration.',
      )
    }
    if (command === 'status') {
      printAccess(state)
      console.log(run('docker', [...composeArguments(state), 'ps']))
      return
    }
    if (!['setup', 'local', 'lan'].includes(command ?? '')) {
      throw new Error(
        'Usage: network-access.ts setup [--hostname name.local] [--address private-IP] | local | lan [--address private-IP] | status',
      )
    }
    if (command !== 'setup' && !state.initialized) {
      throw new Error('Initial setup did not complete. Retry access:setup before switching modes.')
    }
    if (command === 'setup') {
      run('docker', ['image', 'inspect', proxyImage], false)
      prepareCertificates(directory, state.profile)
      writeHostSetup(directory, state.profile)
    }
    if (command !== 'setup') {
      state.mode = command as AccessMode
    }
    if (option('--hostname') && option('--hostname') !== state.profile.hostname) {
      throw new Error(
        'The configured hostname is stable. Changing it requires a separate identity cutover.',
      )
    }
    if (state.mode === 'lan') {
      state.profile.address = lanAddress(option('--address') ?? state.profile.address)
    }
    await apply(state, environment, command === 'setup' && !state.initialized)
    printAccess(state)
  } finally {
    closeSync(lock)
    rmSync(lockPath)
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Network setup failed.')
    process.exitCode = 1
  })
}
