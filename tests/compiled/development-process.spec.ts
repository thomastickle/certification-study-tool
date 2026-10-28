import assert from 'node:assert/strict'
import { fork, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { randomBytes } from 'node:crypto'
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  watch,
  writeFileSync,
  existsSync,
} from 'node:fs'
import { createServer, request, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { DevelopmentApplication } from '../../src/server/web/development-application.ts'
import { ApplicationRuntime } from '../../src/server/runtime/application-runtime.ts'
import { SecurityRequestLifetime } from '../../src/server/security/security-lifetime.ts'
import { StudyLibraryScope } from '../../src/server/runtime/study-library-scope.ts'
import type { SessionUser } from '../../src/shared/auth-contracts.ts'
import type { LibraryRepository } from '../../src/server/questions/library-repository.ts'
import { JsonBodyInterceptor } from '../../src/server/security/json-body.interceptor.ts'
import type { AdmittedRequest } from '../../src/server/security/security-context.ts'
import { runtimeConfiguration } from '../../src/server/runtime/runtime-configuration.ts'
import { BrowserCookies } from '../support/browser-cookies.ts'
import { oidcFixture, closeServer } from '../oidc-fixture.ts'
import { bank } from '../fixtures.ts'

/** Bound protocol event waits without polling application state. */
function bounded<T>(operation: Promise<T>, label: string): Promise<T> {
  let timer: NodeJS.Timeout
  return Promise.race([
    operation,
    new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`Timed out: ${label}`)), 12000)
    }),
  ]).finally(() => clearTimeout(timer))
}

/** Reserve a disposable loopback address; startup still tests real listen failures. */
async function freePort() {
  const server = createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const port = (server.address() as AddressInfo).port
  await closeServer(server)
  return port
}

/** Keep source/config edits and all SQLite files outside the checkout and human state. */
async function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'study-vite-process-'))
  cpSync('src/web', join(root, 'src/web'), { recursive: true })
  cpSync('src/shared', join(root, 'src/shared'), { recursive: true })
  writeFileSync(
    join(root, 'vite.config.ts'),
    readFileSync('vite.config.ts', 'utf8').replace(
      'defineConfig({',
      `defineConfig({ cacheDir: ${JSON.stringify(join(root, '.vite'))},`,
    ),
  )
  symlinkSync(resolve('node_modules'), join(root, 'node_modules'))
  writeFileSync(join(root, 'package.json'), '{"type":"module"}')
  const provider = await oidcFixture('/realms/test', (subject) => ({
    study_roles: subject === 'alice' ? ['admin'] : [],
  }))
  const port = await freePort()
  const configuration = runtimeConfiguration({
    STUDY_PORT: String(port),
    STUDY_DB_PATH: join(root, 'private/library.sqlite3'),
    STUDY_OIDC_ISSUER: provider.issuerIdentifier,
  })
  const owner = new DevelopmentApplication(configuration, root)
  const origin = configuration.origin.origin

  const call = (path: string, jar = new BrowserCookies(), init: RequestInit = {}) =>
    fetch(origin + path, {
      ...init,
      redirect: 'manual',
      headers: { Origin: origin, Cookie: jar.header(path.split('?')[0]!), ...init.headers },
    })

  const login = async (subject = 'alice') => {
    const jar = new BrowserCookies()
    const start = await call('/auth/login', jar)
    assert.equal(start.status, 302)
    jar.accept(start)
    const auth = new URL(start.headers.get('location')!)
    assert.equal(auth.searchParams.get('redirect_uri'), origin + '/auth/callback')
    auth.searchParams.set('user', subject)
    const authorized = await fetch(auth, { redirect: 'manual' })
    const callback = new URL(authorized.headers.get('location')!)
    assert.equal(callback.origin, origin)
    const returned = await call(callback.pathname + callback.search, jar)
    assert.equal(returned.status, 302)
    jar.accept(returned)
    assert.equal((await call(callback.pathname + callback.search, jar)).status, 400)
    const session = await call('/api/session', jar)
    assert.equal(session.status, 200)
    const user = (await session.json()).user as { id: string }
    return { jar, user }
  }

  return {
    root,
    port,
    owner,
    origin,
    configuration,
    call,
    login,
    async close() {
      await owner.close()
      await closeServer(provider.server)
      rmSync(root, { recursive: true, force: true })
    },
  }
}

/** Send the unnormalized target and optional upgrade headers directly over Node HTTP. */
function raw(origin: string, path: string, headers = {}) {
  return bounded(
    new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = request(origin, { path, headers }, (response) => {
        let body = ''
        response.on('data', (chunk) => {
          body += chunk
        })
        response.on('end', () => resolve({ status: response.statusCode!, body }))
      })
      req.on('error', reject)
      req.end()
    }),
    'raw response',
  )
}

/** Observe file replacement via the containing directory rather than binding the previous inode. */
function changed(root: string, name: string, value: string) {
  let watcher: ReturnType<typeof watch>
  return bounded(
    new Promise<void>((resolve) => {
      watcher = watch(root, () => {
        if (existsSync(join(root, name)) && readFileSync(join(root, name), 'utf8') === value) {
          resolve()
        }
      })
    }),
    'stock restart listening',
  ).finally(() => watcher.close())
}

test(
  'real development composition proxies signed sessions, raw admission, source/HMR and stock config restart',
  { timeout: 45000 },
  async () => {
    const f = await fixture()
    let ws: WebSocket | undefined
    try {
      await f.owner.start()
      assert.equal((await f.call('/api/health')).status, 200)
      const actor = await f.login()

      const api = () =>
        f.call('/api/questions', actor.jar, { headers: { 'X-Study-Account': actor.user.id } })

      assert.equal((await api()).status, 200)
      const bob = await f.login('bob')
      assert.notEqual(bob.user.id, actor.user.id)
      assert.equal(
        (await f.call('/api/questions', actor.jar, { headers: { 'X-Study-Account': bob.user.id } }))
          .status,
        409,
      )
      for (const path of ['/api/imports/preview', '/api/imports/confirm']) {
        assert.equal(
          (
            await f.call(path, bob.jar, {
              method: 'POST',
              headers: { 'X-Study-Account': bob.user.id, 'Content-Type': 'application/json' },
              body: 'INVALID',
            })
          ).status,
          403,
        )
      }
      const input = bank()
      input.questions = Array.from({ length: 20 }, (_, index) => ({
        ...structuredClone(input.questions[0]!),
        source_ref: String(index),
        question: `Owned private question ${index}?`,
      }))

      const privateCall = (path: string, body: unknown, user = actor) =>
        f.call(path, user.jar, {
          method: 'POST',
          headers: { 'X-Study-Account': user.user.id, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })

      const preview = await privateCall('/api/private/imports/preview', { bank: input })
      assert.equal(preview.status, 200)
      const token = (await preview.json()).token
      const confirmation = { bank: input, token, reviewed: true }
      assert.equal(
        (await privateCall('/api/private/imports/confirm', confirmation, bob)).status,
        409,
      )
      assert.equal((await privateCall('/api/private/imports/confirm', confirmation)).status, 201)
      assert.equal((await privateCall('/api/private/imports/confirm', confirmation)).status, 409)
      const ownSources = await f.call('/api/private/sources', actor.jar, {
        headers: { 'X-Study-Account': actor.user.id },
      })
      const otherSources = await f.call('/api/private/sources', bob.jar, {
        headers: { 'X-Study-Account': bob.user.id },
      })
      assert.equal((await ownSources.json()).length, 1)
      assert.equal((await otherSources.json()).length, 0)
      const quizResponse = await privateCall('/api/quizzes', {
        provider: 'Example',
        certification: 'DEMO-1',
        sourceFilter: 'mixed',
        questionType: 'mixed',
        sourceIds: ['private:1'],
      })
      assert.equal(quizResponse.status, 201)
      const quiz = await quizResponse.json()
      assert.equal(
        (
          await f.call(`/api/quizzes/${quiz.id}`, bob.jar, {
            headers: { 'X-Study-Account': bob.user.id },
          })
        ).status,
        404,
      )
      assert.equal((await f.call('/auth/logout', bob.jar, { method: 'POST' })).status, 303)
      assert.equal(
        (await f.call('/api/questions', bob.jar, { headers: { 'X-Study-Account': bob.user.id } }))
          .status,
        401,
      )
      const source = await f.call('/main.tsx')
      assert.equal(source.status, 200)
      assert.match(await source.text(), /import/)
      for (const path of [
        '/',
        '/main.tsx',
        '/api/health',
        'http://foreign.example/api/health',
        '//foreign.example/api/health',
      ]) {
        for (const headers of [
          { Host: 'foreign.example' },
          { Origin: 'https://foreign.example' },
        ]) {
          const denial = await raw(f.origin, path, headers)
          assert.equal(denial.status, 403)
          assert.match(denial.body, /Local access only|Cross-site requests are not allowed/)
        }
      }
      for (const headers of [{ Host: 'foreign.example' }, { Origin: 'https://foreign.example' }]) {
        assert.equal(
          (
            await raw(f.origin, '/', {
              Connection: 'Upgrade',
              Upgrade: 'websocket',
              'Sec-WebSocket-Version': '13',
              'Sec-WebSocket-Key': randomBytes(16).toString('base64'),
              ...headers,
            })
          ).status,
          403,
        )
      }
      assert.equal((await raw(f.origin, 'http://foreign.example/api/health')).status, 403)
      assert.equal((await raw(f.origin, 'http://[')).status, 500)
      assert.equal((await f.call('/api/missing')).headers.get('content-type'), 'application/json')
      ws = new WebSocket(f.origin.replace('http:', 'ws:') + '/', 'vite-hmr')
      await bounded(once(ws, 'open'), 'HMR connection')
      await f.call('/app/themes/base.css')
      const update = bounded(
        new Promise<void>((resolve) => {
          ws!.addEventListener('message', (event) => {
            const message = JSON.parse(String(event.data))
            if (message.type === 'update') {
              resolve()
            }
          })
        }),
        'atomic CSS HMR update',
      )
      const css = join(f.root, 'src/web/app/themes/base.css')
      writeFileSync(css + '.new', readFileSync(css, 'utf8') + '\n/* process HMR test */\n')
      renameSync(css + '.new', css)
      await update
      const config = join(f.root, 'vite.config.ts')
      const restarted = changed(f.root, 'listening', 'restarted')
      writeFileSync(
        config + '.new',
        readFileSync(config, 'utf8').replace(
          'defineConfig({',
          `defineConfig({ plugins: [{ name: 'listen-observer', configureServer(vite) { return () => vite.httpServer.once('listening', () => { import('node:fs').then(fs => fs.writeFileSync(${JSON.stringify(join(f.root, 'listening'))}, 'restarted')) }) } }],`,
        ),
      )
      renameSync(config + '.new', config)
      await restarted
      assert.equal((await api()).status, 200)
      assert.equal((await raw(f.origin, '/', { Origin: 'https://foreign.example' })).status, 403)
    } finally {
      ws?.close()
      await f.close()
    }
  },
)

test(
  'stock invalid-config recovery, replacement gap and shutdown during restart retain process ownership',
  { timeout: 45000 },
  async () => {
    const f = await fixture()
    const config = join(f.root, 'vite.config.ts')
    const original = readFileSync(config, 'utf8')
    const failedMarker = join(f.root, 'restart-failed')
    const recoveredMarker = join(f.root, 'recovered')
    const pendingMarker = join(f.root, 'restart-pending')
    const logger = `import { createLogger } from 'vite'; import { writeFileSync } from 'node:fs'; const logger = createLogger();
`
    const observed = `customLogger: { ...logger, error(message, options) { logger.error(message, options); if (message === 'server restart failed') writeFileSync(${JSON.stringify(failedMarker)}, 'failed') } },`
    writeFileSync(config, logger + original.replace('defineConfig({', `defineConfig({ ${observed}`))
    try {
      await f.owner.start()
      const actor = await f.login()

      const api = () =>
        f.call('/api/questions', actor.jar, { headers: { 'X-Study-Account': actor.user.id } })

      const failed = changed(f.root, 'restart-failed', 'failed')
      writeFileSync(
        config + '.new',
        "throw new Error('expected invalid config')\nexport default {}\n",
      )
      renameSync(config + '.new', config)
      await failed
      assert.equal((await api()).status, 200, 'stock failed config retains the serving generation')
      const gap = bounded(
        new Promise<void>((resolve) => {
          const watcher = watch(f.root, (_event, name) => {
            if (name === 'vite.config.ts' && !existsSync(config)) {
              watcher.close()
              resolve()
            }
          })
        }),
        'owned config unlink gap',
      )
      unlinkSync(config)
      await gap
      const recovered = changed(f.root, 'recovered', 'yes')
      writeFileSync(
        config + '.new',
        logger +
          original.replace(
            'defineConfig({',
            `defineConfig({ ${observed} plugins: [{ name: 'recovery-observer', configureServer(server) { return () => server.httpServer.once('listening', () => writeFileSync(${JSON.stringify(recoveredMarker)}, 'yes')) } }],`,
          ),
      )
      renameSync(config + '.new', config)
      await recovered
      assert.equal((await api()).status, 200)
      assert.equal((await raw(f.origin, '/', { Origin: 'https://foreign.example' })).status, 403)
      const pending = changed(f.root, 'restart-pending', 'yes')
      writeFileSync(
        config + '.new',
        logger +
          original.replace(
            'defineConfig({',
            `defineConfig({ plugins: [{ name: 'pending-restart', async configureServer(server) { await new Promise(resolve => server.watcher.once('ready', resolve)); writeFileSync(${JSON.stringify(pendingMarker)}, 'yes'); await new Promise(() => {}) } }],`,
          ),
      )
      renameSync(config + '.new', config)
      await pending
      const frontendPid = Number(
        readFileSync(`/proc/${process.pid}/task/${process.pid}/children`, 'utf8').trim(),
      )
      assert.ok(Number.isInteger(frontendPid) && frontendPid > 0)
      await bounded(f.owner.close(), 'shutdown during stock restart')
      assert.throws(() => process.kill(-frontendPid, 0), { code: 'ESRCH' })
      await assert.rejects(fetch(f.origin + '/api/health'))
    } finally {
      await f.close()
    }
  },
)

test(
  'development close cancels an authorized partial body, joins late work before roots and closes HMR/endpoints',
  { timeout: 30000 },
  async (t) => {
    const f = await fixture()
    let ws: WebSocket | undefined
    let entered!: () => void
    const running = new Promise<void>((resolve) => {
      entered = resolve
    })
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    let completed = false
    let latePersonal: LibraryRepository | undefined
    try {
      await f.owner.start()
      const backend = await f.owner.backend
      const runtime = backend.get(ApplicationRuntime)
      const actor = await f.login()
      const originalScope = StudyLibraryScope.prototype.withLibrary
      t.mock.method(StudyLibraryScope.prototype, 'withLibrary', async function <
        T,
      >(this: StudyLibraryScope, actor: SessionUser, method: string | undefined, work: (personal: LibraryRepository) => Promise<T>): Promise<T> {
        return originalScope.call(this, actor, method, async (personal) => {
          if (method === 'GET') {
            latePersonal = personal
            entered()
            await held
            personal.sources()
            runtime.sharedLibrary.sources()
            completed = true
          }
          return work(personal)
        }) as Promise<T>
      })
      let bodyEntered!: () => void
      const bodyRunning = new Promise<void>((resolve) => {
        bodyEntered = resolve
      })
      let bodySettled = false
      let bodyDone!: () => void
      const cancelledBody = new Promise<void>((resolve) => {
        bodyDone = resolve
      })
      const originalBody = JsonBodyInterceptor.prototype.intercept
      t.mock.method(
        JsonBodyInterceptor.prototype,
        'intercept',
        async function (this: JsonBodyInterceptor, ...args: Parameters<typeof originalBody>) {
          const request = args[0].switchToHttp().getRequest<AdmittedRequest>()
          const reading = originalBody.apply(this, args)
          bodyEntered()
          try {
            return await reading
          } finally {
            request.studyContext!.personal.sources()
            bodySettled = true
            bodyDone()
          }
        },
      )

      ws = new WebSocket(f.origin.replace('http:', 'ws:') + '/', 'vite-hmr')
      await bounded(once(ws, 'open'), 'HMR connection')
      const socketClosed = once(ws, 'close')
      const req = request(f.origin + '/api/quizzes', {
        method: 'POST',
        headers: {
          Origin: f.origin,
          Cookie: actor.jar.header('/api/quizzes'),
          'X-Study-Account': actor.user.id,
          'Content-Type': 'application/json',
          'Content-Length': '100000',
        },
      })
      req.on('error', () => undefined)
      req.write('{')
      await bounded(bodyRunning, 'authorized backend body reader entered')
      // Hold real transport work past disconnect; root access must remain valid until it settles.
      const lateRequest = f
        .call('/api/sources', actor.jar, { headers: { 'X-Study-Account': actor.user.id } })
        .catch(() => undefined)
      await bounded(running, 'late HTTP work entered')
      let drainEntered!: () => void
      const draining = new Promise<void>((resolve) => {
        drainEntered = resolve
      })
      const lifetime = backend.get(SecurityRequestLifetime)
      const originalDrain = lifetime.drain.bind(lifetime)
      t.mock.method(lifetime, 'drain', (server: Server) => {
        drainEntered()
        return originalDrain(server)
      })
      const closed = f.owner.close()
      assert.equal(f.owner.close(), closed)
      await bounded(draining, 'backend drainage entered')
      await bounded(cancelledBody, 'authorized body cancelled with personal storage still open')
      runtime.sharedLibrary.sources()
      assert.equal((await f.call('/api/health')).status, 503)
      assert.equal(completed, false)
      release()
      await lateRequest
      await bounded(closed, 'development close')
      assert.equal(completed, true)
      assert.equal(bodySettled, true)
      assert.ok(latePersonal)
      assert.throws(() => latePersonal!.sources(), /closed|not open/)
      await bounded(socketClosed, 'HMR close')
      req.destroy()
      assert.throws(() => runtime.sharedLibrary.sources(), /closed|not open/)
      await assert.rejects(fetch(f.origin + '/api/health'))
      const address = backend.getHttpServer().address()
      assert.equal(address, null)
    } finally {
      release()
      ws?.close()
      await f.close()
    }
  },
)

test(
  'occupied public port and watcher-acquired configureServer failure dispose backend roots and child',
  { timeout: 40000 },
  async () => {
    for (const failure of ['port', 'watcher']) {
      const f = await fixture()
      const blocker = createServer()
      try {
        if (failure === 'port') {
          blocker.listen(f.port, '127.0.0.1')
          await once(blocker, 'listening')
        } else {
          writeFileSync(
            join(f.root, 'vite.config.ts'),
            `export default { plugins: [{ name: 'acquired-failure', async configureServer(vite) { await new Promise(resolve => vite.watcher.once('ready', resolve)); (await import('node:fs')).writeFileSync(${JSON.stringify(join(f.root, 'acquired'))}, 'yes'); throw Error('owned synthetic failure') } }] }`,
          )
        }
        const backend = await f.owner.backend
        const runtime = backend.get(ApplicationRuntime)
        await assert.rejects(f.owner.start(), /frontend/)
        if (failure === 'watcher') {
          assert.equal(readFileSync(join(f.root, 'acquired'), 'utf8'), 'yes')
        }
        assert.throws(() => runtime.sharedLibrary.sources(), /closed|not open/)
        await f.owner.close()
      } finally {
        if (blocker.listening) {
          await closeServer(blocker)
        }
        await f.close()
      }
    }
  },
)

test(
  'close during pending frontend readiness cancels startup and joins partial initialization',
  { timeout: 30000 },
  async () => {
    const f = await fixture()
    try {
      const acquired = changed(f.root, 'pending', 'yes')
      writeFileSync(
        join(f.root, 'vite.config.ts'),
        `export default { plugins: [{ name: 'pending-ready', async configureServer(vite) { await new Promise(resolve => vite.watcher.once('ready', resolve)); (await import('node:fs')).writeFileSync(${JSON.stringify(join(f.root, 'pending'))}, 'yes'); await new Promise(() => {}) } }] }`,
      )
      const starting = f.owner.start()
      const rejected = assert.rejects(starting, /closing/)
      await acquired
      await bounded(
        Promise.all([f.owner.close(), f.owner.close(), rejected]),
        'close pending readiness',
      )
      const backend = await f.owner.backend
      assert.throws(
        () => backend.get(ApplicationRuntime).sharedLibrary.sources(),
        /closed|not open/,
      )
      await assert.rejects(fetch(f.origin + '/api/health'))
    } finally {
      await f.close()
    }
  },
)

/** Wait for compiled main's public startup announcement, retaining only non-secret process diagnostics. */
function ready(child: ChildProcess) {
  return bounded(
    new Promise<void>((resolve, reject) => {
      child.stdout!.on('data', (data) => {
        if (String(data).includes('Certification Study Tool:')) {
          resolve()
        }
      })
      child.once('exit', () => reject(new Error('Main exited before public readiness.')))
    }),
    'compiled main startup',
  )
}

for (const crash of [false, true]) {
  test(
    `compiled development main owns a frontend child and closes the generation (crash=${crash})`,
    { timeout: 30000 },
    async () => {
      const f = await fixture()
      const child = fork(resolve('build/src/server/main.js'), [], {
        cwd: f.root,
        execArgv: [],
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
        env: {
          PATH: process.env.PATH,
          STUDY_PORT: String(f.port),
          STUDY_DB_PATH: join(f.root, 'main/library.sqlite3'),
          STUDY_OIDC_ISSUER: f.configuration.authentication.issuer,
          STUDY_OIDC_CLIENT_SECRET: 'synthetic-confidential-value',
          VITE_PROCESS_TEST: 'public-marker',
        },
      })
      child.stderr!.resume()
      const exit = once(child, 'exit')
      try {
        await ready(child)
        assert.equal((await f.call('/api/health')).status, 200)
        const descendants = readFileSync(`/proc/${child.pid}/task/${child.pid}/children`, 'utf8')
          .trim()
          .split(/\s+/)
          .filter(Boolean)
        assert.equal(descendants.length, 1, 'actual main must own a separate frontend process')
        assert.match(
          readFileSync(`/proc/${descendants[0]}/cmdline`, 'utf8'),
          /development-frontend\.js/,
        )
        const environmentNames = readFileSync(`/proc/${descendants[0]}/environ`, 'utf8')
          .split('\0')
          .map((entry) => entry.split('=')[0])
        assert.equal(
          environmentNames.some((name) => name?.startsWith('STUDY_')),
          false,
        )
        assert.ok(environmentNames.includes('VITE_PROCESS_TEST'))
        if (crash) {
          process.kill(Number(descendants[0]), 'SIGKILL')
        } else {
          child.kill('SIGTERM')
          child.kill('SIGTERM')
        }
        assert.equal((await bounded(exit, 'compiled main exit'))[0], crash ? 1 : 0)
        assert.throws(() => process.kill(-Number(descendants[0]), 0), { code: 'ESRCH' })
        for (const pid of descendants) {
          assert.equal(existsSync(`/proc/${pid}`), false)
        }
        await assert.rejects(fetch(f.origin + '/api/health'))
      } finally {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill('SIGTERM')
          await bounded(exit, 'main failure cleanup').catch(async () => {
            child.kill('SIGKILL')
            await exit
          })
        }
        await f.close()
      }
    },
  )
}
