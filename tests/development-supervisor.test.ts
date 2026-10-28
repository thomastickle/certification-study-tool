import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  renameSync,
  unlinkSync,
} from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { test } from 'node:test'

const linuxOnly = process.platform === 'linux'
const runtimeFailureProbe =
  "if (process.env.STUDY_TEST_STARTUP_FAILURE === '1') throw new Error('Synthetic startup failure')\n"

type DevelopmentFixture = {
  child: ReturnType<typeof spawn>
  directory: string
  exit: Promise<{ code: number | null; signal: NodeJS.Signals | null }>
  output(): string
  port: number
}

test(
  'development survives a root config removal gap and rebuilds after recreation',
  { skip: !linuxOnly },
  async () => {
    const fixture = await createFixture()
    try {
      await waitFor(fixture, () => healthIsReady(fixture.port), 'Initial server')
      const configuration = join(fixture.directory, 'tsconfig.server.json')
      const original = readFileSync(configuration)
      const starts = countMatches(fixture.output(), /Certification Study Tool:/g)
      unlinkSync(configuration)
      await waitFor(
        fixture,
        () => fixture.output().includes('Waiting for a source change.'),
        'Missing config build failure',
      )
      assert.equal(fixture.child.exitCode, null)
      writeFileSync(configuration, original)
      await waitFor(
        fixture,
        async () =>
          countMatches(fixture.output(), /Certification Study Tool:/g) > starts &&
          (await healthIsReady(fixture.port)),
        'Recreated config rebuild',
      )
    } finally {
      await cleanup(fixture)
    }
  },
)

/** Make a disposable project with the real build and dev scripts. */
async function createFixture(
  options: { invalidTypeScript?: boolean; runtimeFailure?: boolean } = {},
) {
  const directory = mkdtempSync(join(tmpdir(), 'study-dev-supervisor-'))
  for (const file of [
    'src',
    'docs',
    'scripts',
    'package.json',
    'tsconfig.json',
    'tsconfig.server.json',
    'vite.config.ts',
  ]) {
    cpSync(file, join(directory, file), { recursive: true })
  }
  symlinkSync(resolve('node_modules'), join(directory, 'node_modules'), 'dir')

  if (options.invalidTypeScript) {
    writeFileSync(join(directory, 'src/server/review-probe.ts'), 'const invalid: string = 123\n')
  }
  if (options.runtimeFailure) {
    const main = join(directory, 'src/server/main.ts')
    const source = readFileSync(main, 'utf8')
    writeFileSync(
      main,
      source.replace('const configuration =', `${runtimeFailureProbe}const configuration =`),
    )
  }

  const reservation = createServer()
  await new Promise<void>((resolveListen) => reservation.listen(0, '127.0.0.1', resolveListen))
  const address = reservation.address()
  assert.ok(address && typeof address !== 'string')
  await new Promise<void>((resolveClose) => reservation.close(() => resolveClose()))

  const origin = `http://127.0.0.1:${address.port}`
  const environment = {
    ...process.env,
    NODE_ENV: 'development',
    STUDY_HOST: '127.0.0.1',
    STUDY_PORT: String(address.port),
    STUDY_ORIGIN: origin,
    STUDY_DB_PATH: join(directory, 'data/library.sqlite3'),
    STUDY_ACCOUNTS_PATH: join(directory, 'data/accounts.sqlite3'),
    STUDY_PRIVATE_LIBRARIES_DIR: join(directory, 'data/users'),
    STUDY_LEGACY_OWNER_SUBJECT: '',
    STUDY_OIDC_ISSUER: 'http://127.0.0.1:1/synthetic',
    STUDY_OIDC_CLIENT_ID: 'synthetic',
    STUDY_OIDC_CLIENT_SECRET: '',
    STUDY_TEST_STARTUP_FAILURE: options.runtimeFailure ? '1' : '0',
    npm_execpath: join(dirname(process.execPath), 'npm'),
  }
  const child = spawn(process.execPath, ['--env-file-if-exists=.env', 'scripts/development.ts'], {
    cwd: directory,
    detached: true,
    env: environment,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''

  const capture = (chunk: Buffer | string) => {
    output = (output + String(chunk)).slice(-200_000)
  }

  child.stdout.on('data', capture)
  child.stderr.on('data', capture)
  const exit = once(child, 'exit').then(([code, signal]) => ({
    code: code as number | null,
    signal: signal as NodeJS.Signals | null,
  }))

  return {
    child,
    directory,
    exit,
    output: () => output,
    port: address.port,
  } satisfies DevelopmentFixture
}

/** Wait for an observable process or HTTP condition without using a fixed startup delay. */
async function waitFor(
  fixture: DevelopmentFixture,
  condition: () => boolean | Promise<boolean>,
  description: string,
  timeoutMs = 20_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!(await condition())) {
    assert.equal(fixture.child.exitCode, null, `${description}; dev process exited early`)
    assert.ok(Date.now() < deadline, `${description}; output: ${fixture.output().slice(-2000)}`)
    await delay(25)
  }
}

/** Count one exact diagnostic in the captured development process output. */
function countMatches(output: string, pattern: RegExp): number {
  return [...output.matchAll(pattern)].length
}

/** Report live processes owned by one detached test process group. */
function processGroupMembers(groupId: number): Array<{ pid: number; command: string }> {
  const members: Array<{ pid: number; command: string }> = []
  for (const entry of readdirSync('/proc')) {
    if (!/^\d+$/.test(entry)) {
      continue
    }
    try {
      const processId = Number(entry)
      const stat = readFileSync(`/proc/${entry}/stat`, 'utf8')
      const stateFields = stat
        .slice(stat.lastIndexOf(')') + 2)
        .trim()
        .split(/\s+/)
      if (Number(stateFields[2]) !== groupId || ['Z', 'X'].includes(stateFields[0] ?? '')) {
        continue
      }
      const command = readFileSync(`/proc/${entry}/cmdline`, 'utf8').replaceAll('\0', ' ')
      members.push({ pid: processId, command })
    } catch {
      // The process may exit between listing /proc and reading its metadata.
    }
  }
  return members
}

/** Stop only the detached process group created for this test and wait for its descendants. */
async function cleanup(fixture: DevelopmentFixture): Promise<void> {
  const groupId = fixture.child.pid
  if (!groupId) {
    rmSync(fixture.directory, { recursive: true, force: true })
    return
  }

  try {
    process.kill(-groupId, 'SIGTERM')
  } catch {
    // The group may already have exited.
  }
  await delay(500)
  if (processGroupMembers(groupId).length > 0) {
    try {
      process.kill(-groupId, 'SIGKILL')
    } catch {
      // The group may have exited between the check and signal.
    }
  }
  await waitForGroupToExit(groupId)
  rmSync(fixture.directory, { recursive: true, force: true })
}

/** Ensure no process in the test-owned group can continue writing its scratch build. */
async function waitForGroupToExit(groupId: number): Promise<void> {
  const deadline = Date.now() + 3000
  while (processGroupMembers(groupId).length > 0 && Date.now() < deadline) {
    await delay(25)
  }
  assert.deepEqual(processGroupMembers(groupId), [], 'Test process group must be empty')
}

/** Readiness depends on the public health endpoint, not on a startup log line alone. */
async function healthIsReady(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/health`)
    return response.status === 200 && (await response.text()) === '{"status":"ok"}'
  } catch {
    return false
  }
}

test(
  'development waits for a source edit after a failed build and recovers',
  {
    skip: !linuxOnly,
  },
  async () => {
    const fixture = await createFixture({ invalidTypeScript: true })
    try {
      await waitFor(
        fixture,
        () => fixture.output().includes('Server build exited with status'),
        'Initial TypeScript failure',
      )
      await delay(6000)
      assert.equal(countMatches(fixture.output(), /error TS2322/g), 1)

      writeFileSync(
        join(fixture.directory, 'src/server/review-probe.ts'),
        'export const valid = true\n',
      )
      await waitFor(fixture, () => healthIsReady(fixture.port), 'Recovered server')
      assert.equal(await healthIsReady(fixture.port), true)
    } finally {
      await cleanup(fixture)
    }
  },
)

test(
  'development recovers from a runtime startup error and closes after SIGTERM',
  {
    skip: !linuxOnly,
  },
  async () => {
    const fixture = await createFixture({ runtimeFailure: true })
    try {
      await waitFor(
        fixture,
        () => fixture.output().includes('Development server exited (1)'),
        'Runtime startup failure',
      )
      await delay(100)
      assert.equal(fixture.child.exitCode, null)

      const main = join(fixture.directory, 'src/server/main.ts')
      const source = readFileSync(main, 'utf8')
      writeFileSync(main, source.replace(runtimeFailureProbe, ''))
      await waitFor(fixture, () => healthIsReady(fixture.port), 'Recovered server')
      assert.equal(await healthIsReady(fixture.port), true)

      fixture.child.kill('SIGTERM')
      const result = await Promise.race([fixture.exit, delay(8000).then(() => undefined)])
      assert.deepEqual(result, { code: 0, signal: null })
      assert.deepEqual(processGroupMembers(fixture.child.pid!), [])
    } finally {
      await cleanup(fixture)
    }
  },
)

test(
  'development serializes rapid rebuilds and waits for the compiler on SIGTERM',
  {
    skip: !linuxOnly,
  },
  async () => {
    const fixture = await createFixture()
    const groupId = fixture.child.pid!
    let maximumCompilers = 0
    const sampleCompilers = setInterval(() => {
      const activeCompilers = processGroupMembers(groupId).filter((member) =>
        member.command.includes('typescript/bin/tsc6'),
      ).length
      maximumCompilers = Math.max(maximumCompilers, activeCompilers)
    }, 10)

    try {
      await waitFor(
        fixture,
        () =>
          processGroupMembers(groupId).some((member) =>
            member.command.includes('typescript/bin/tsc6'),
          ),
        'Initial compiler process',
      )
      const config = join(fixture.directory, 'tsconfig.server.json')
      for (let edit = 0; edit < 3; edit += 1) {
        const temporaryConfig = join(fixture.directory, 'tsconfig.server.next.json')
        writeFileSync(temporaryConfig, readFileSync(config))
        renameSync(temporaryConfig, config)
      }
      await waitFor(fixture, () => healthIsReady(fixture.port), 'First server')
      await waitFor(
        fixture,
        () => fixture.output().split('Certification Study Tool:').length >= 2,
        'Server start',
      )
      assert.equal(maximumCompilers, 1, 'At most one TypeScript compiler may write build/')

      writeFileSync(
        join(fixture.directory, 'src/server/shutdown-probe.ts'),
        'export const shutdownProbe = true\n',
      )
      await waitFor(
        fixture,
        () =>
          processGroupMembers(groupId).some((member) =>
            member.command.includes('typescript/bin/tsc6'),
          ),
        'Restart compiler process',
      )
      fixture.child.kill('SIGTERM')
      const result = await Promise.race([fixture.exit, delay(8000).then(() => undefined)])
      assert.deepEqual(result, { code: 0, signal: null })
      await waitForGroupToExit(groupId)
    } finally {
      clearInterval(sampleCompilers)
      await cleanup(fixture)
    }
  },
)

test(
  'the build process forwards terminal SIGINT and leaves no compiler behind',
  {
    skip: !linuxOnly,
  },
  async () => {
    const fixture = await createFixture()
    const groupId = fixture.child.pid!
    try {
      await waitFor(
        fixture,
        () =>
          processGroupMembers(groupId).some((member) =>
            member.command.includes('typescript/bin/tsc6'),
          ),
        'Compiler process before terminal SIGINT',
      )
      process.kill(-groupId, 'SIGINT')

      const result = await Promise.race([fixture.exit, delay(8000).then(() => undefined)])
      assert.deepEqual(result, { code: 0, signal: null })
      await waitForGroupToExit(groupId)
    } finally {
      await cleanup(fixture)
    }
  },
)

test(
  'development survives a root config deletion gap and rebuilds after recreation',
  { skip: !linuxOnly },
  async () => {
    const fixture = await createFixture()
    try {
      await waitFor(fixture, () => healthIsReady(fixture.port), 'Initial server')
      const config = join(fixture.directory, 'tsconfig.server.json')
      const original = readFileSync(config)
      const starts = countMatches(fixture.output(), /Certification Study Tool:/g)
      unlinkSync(config)
      await waitFor(
        fixture,
        () => fixture.output().includes('Server build exited with status'),
        'Missing config build',
      )
      assert.equal(fixture.child.exitCode, null)
      writeFileSync(config, original)
      await waitFor(
        fixture,
        () => countMatches(fixture.output(), /Certification Study Tool:/g) > starts,
        'Recreated config restart',
      )
      assert.equal(await healthIsReady(fixture.port), true)
    } finally {
      await cleanup(fixture)
    }
  },
)
