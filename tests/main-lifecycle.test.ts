import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'

/** Launch only the compiled entry point with disposable paths and an isolated working directory. */
function launch(directory: string, port: number, production: boolean) {
  const observer = join(directory, 'observe-sqlite.mjs')
  writeFileSync(
    observer,
    `
    import { DatabaseSync } from 'node:sqlite'
    import { writeFileSync } from 'node:fs'
    const handles = new Set()
    const prepare = DatabaseSync.prototype.prepare
    DatabaseSync.prototype.prepare = function (...args) {
      handles.add(this)
      return prepare.apply(this, args)
    }
    process.on('exit', () => {
      const unclosed = [...handles].filter(db => db.isOpen).length
      writeFileSync(${JSON.stringify(join(directory, 'sqlite-ownership.json'))},
        JSON.stringify({ opened: handles.size, unclosed }), { mode: 0o600 })
    })
  `,
    { mode: 0o600 },
  )
  const child = spawn(
    process.execPath,
    ['--import', observer, resolve('build/src/server/main.js')],
    {
      cwd: directory,
      timeout: 15000,
      killSignal: 'SIGKILL',
      env: {
        ...process.env,
        NODE_ENV: production ? 'production' : 'development',
        STUDY_HOST: '127.0.0.1',
        STUDY_PORT: String(port),
        STUDY_ORIGIN: `http://127.0.0.1:${port}`,
        STUDY_DB_PATH: join(directory, 'data/library.sqlite3'),
        STUDY_ACCOUNTS_PATH: join(directory, 'data/accounts.sqlite3'),
        STUDY_PRIVATE_LIBRARIES_DIR: join(directory, 'data/users'),
        STUDY_LEGACY_OWNER_SUBJECT: '',
        STUDY_OIDC_ISSUER: 'http://127.0.0.1:1/fixture',
        STUDY_OIDC_CLIENT_ID: 'fixture',
        STUDY_OIDC_CLIENT_SECRET: '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  let output = ''
  const exit = once(child, 'exit')
  const ready = new Promise<void>((done, reject) => {
    child.stdout.on('data', (chunk) => {
      output += String(chunk)
      if (output.includes('Certification Study Tool:')) {
        done()
      }
    })
    child.once('exit', () => reject(new Error('Entry point exited before readiness')))
  })
  void ready.catch(() => {})
  child.stderr.on('data', (chunk) => {
    output += String(chunk)
  })
  return { child, exit, ready, output: () => output }
}

/** SQLite handles do not keep Node alive; inspect explicit closure rather than trusting process exit. */
function assertSqliteClosed(directory: string): void {
  const ownership = JSON.parse(readFileSync(join(directory, 'sqlite-ownership.json'), 'utf8'))
  assert.ok(ownership.opened >= 2, 'The actual accounts and shared roots were acquired')
  assert.equal(ownership.unclosed, 0, 'The entry point must explicitly close all acquired roots')
}

/** Reserve an ephemeral loopback port; never use application or provider operator ports. */
async function reservation() {
  const server = createServer()
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  return { server, port: address.port }
}

for (const production of [false, true]) {
  test(
    `compiled ${production ? 'production' : 'development'} entry point serves HTTP and exits naturally on repeated signals`,
    { timeout: 20000 },
    async () => {
      const directory = mkdtempSync(join(tmpdir(), 'study-main-'))
      mkdirSync(join(directory, 'dist'))
      writeFileSync(
        join(directory, 'dist/index.html'),
        '<!doctype html><title>Production fixture</title>',
      )
      writeFileSync(
        join(directory, 'index.html'),
        '<!doctype html><title>Development fixture</title>',
      )
      const { server, port } = await reservation()
      await new Promise<void>((done) => server.close(() => done()))
      const fixture = launch(directory, port, production)
      try {
        await fixture.ready
        const origin = `http://127.0.0.1:${port}`
        const health = await fetch(`${origin}/api/health`)
        assert.deepEqual(await health.json(), { status: 'ok' })
        const page = await fetch(origin)
        assert.match(await page.text(), production ? /Production fixture/ : /Development fixture/)
        const session = await fetch(`${origin}/api/session`)
        assert.deepEqual(await session.json(), { user: null })
        const denied = await fetch(`${origin}/api/questions`)
        assert.equal(denied.status, 401)
        await denied.arrayBuffer()
        let socket: WebSocket | undefined
        let hmrClosed: Promise<void> | undefined
        if (!production) {
          const client = await fetch(`${origin}/@vite/client`)
          const source = await client.text()
          const token = source.match(/const wsToken = "([^"]+)"/)?.[1]
          assert.ok(token, 'Vite client must expose its HMR connection token')
          socket = new WebSocket(`ws://127.0.0.1:${port}/?token=${token}`, 'vite-hmr')
          hmrClosed = new Promise<void>((done) => {
            socket!.addEventListener('close', () => done(), { once: true })
          })
          await new Promise<void>((done, reject) => {
            socket!.addEventListener('open', () => done(), { once: true })
            socket!.addEventListener('error', () => reject(new Error('HMR connection failed')), {
              once: true,
            })
          })
        }
        fixture.child.kill('SIGINT')
        fixture.child.kill('SIGTERM')
        const [code, signal] = await fixture.exit
        assert.equal(code, 0)
        assert.equal(signal, null)
        assertSqliteClosed(directory)
        if (socket) {
          await hmrClosed
          assert.equal(socket.readyState, WebSocket.CLOSED)
        }
      } finally {
        if (fixture.child.exitCode === null && fixture.child.signalCode === null) {
          fixture.child.kill('SIGKILL')
          await fixture.exit
        }
        rmSync(directory, { recursive: true, force: true })
      }
    },
  )
}

for (const failure of ['vite', 'listen', 'static'] as const) {
  test(
    `compiled entry point cleans up and exits after ${failure} initialization failure`,
    { timeout: 20000 },
    async () => {
      const directory = mkdtempSync(join(tmpdir(), 'study-main-failure-'))
      const { server, port } = await reservation()
      if (failure !== 'listen') {
        await new Promise<void>((done) => server.close(() => done()))
      }
      if (failure === 'vite') {
        writeFileSync(
          join(directory, 'vite.config.ts'),
          "throw new Error('Synthetic Vite initialization failure')\nexport default {}\n",
        )
      }
      const fixture = launch(directory, port, failure === 'static')
      try {
        const [code, signal] = await fixture.exit
        assert.equal(code, 1)
        assert.equal(signal, null)
        assertSqliteClosed(directory)
        assert.match(
          fixture.output(),
          {
            vite: /Synthetic Vite initialization failure/,
            listen: /EADDRINUSE/,
            static: /npm run build/,
          }[failure],
        )
      } finally {
        if (fixture.child.exitCode === null && fixture.child.signalCode === null) {
          fixture.child.kill('SIGKILL')
          await fixture.exit
        }
        if (server.listening) {
          await new Promise<void>((done) => server.close(() => done()))
        }
        rmSync(directory, { recursive: true, force: true })
      }
    },
  )
}

test(
  'a signal during asynchronous Vite initialization waits for acquisition then drains without readiness',
  { timeout: 20000 },
  async () => {
    const directory = mkdtempSync(join(tmpdir(), 'study-startup-signal-'))
    const gate = join(directory, 'release')
    writeFileSync(
      join(directory, 'vite.config.mts'),
      `
    import { existsSync } from 'node:fs'
    import { setTimeout } from 'node:timers/promises'
    console.log('Synthetic initialization gate')
    while (!existsSync(${JSON.stringify(gate)})) { await setTimeout(10) }
    export default {}
  `,
    )
    const { server, port } = await reservation()
    await new Promise<void>((done) => server.close(() => done()))
    const fixture = launch(directory, port, false)
    try {
      await new Promise<void>((done, reject) => {
        fixture.child.stdout.on('data', () => {
          if (fixture.output().includes('Synthetic initialization gate')) {
            done()
          }
        })
        fixture.child.once('exit', () => reject(new Error('Initialization gate was not reached')))
      })
      fixture.child.kill('SIGTERM')
      fixture.child.kill('SIGINT')
      writeFileSync(gate, '')
      const [code, signal] = await fixture.exit
      assert.equal(code, 0)
      assert.equal(signal, null)
      assertSqliteClosed(directory)
      assert.doesNotMatch(fixture.output(), /Certification Study Tool:/)
    } finally {
      if (fixture.child.exitCode === null && fixture.child.signalCode === null) {
        fixture.child.kill('SIGKILL')
        await fixture.exit
      }
      rmSync(directory, { recursive: true, force: true })
    }
  },
)

test('shutdown closes watchers added by finishing Vite hooks', { timeout: 20000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'study-vite-hook-drain-'))
  mkdirSync(join(directory, 'web'))
  const watched = join(directory, 'late-watch.txt')
  writeFileSync(watched, 'disposable watch target')
  writeFileSync(
    join(directory, 'vite.config.mts'),
    `
    export default {
      root: 'web',
      plugins: [{ name: 'late-watch-fixture', closeBundle() {
        this.addWatchFile(${JSON.stringify(watched)})
      } }],
    }
  `,
  )
  const { server, port } = await reservation()
  await new Promise<void>((done) => server.close(() => done()))
  const fixture = launch(directory, port, false)
  try {
    await fixture.ready
    fixture.child.kill('SIGTERM')
    const [code, signal] = await fixture.exit
    assert.equal(signal, null, 'Final Vite hooks must not leave a referenced watcher alive')
    assert.equal(code, 0)
    assertSqliteClosed(directory)
  } finally {
    if (fixture.child.exitCode === null && fixture.child.signalCode === null) {
      fixture.child.kill('SIGKILL')
      await fixture.exit
    }
    rmSync(directory, { recursive: true, force: true })
  }
})
