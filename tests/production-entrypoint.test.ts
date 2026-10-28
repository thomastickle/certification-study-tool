import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { oidcFixture, closeServer } from './oidc-fixture.ts'
import { LibraryRepository } from '../src/server/questions/library-repository.ts'
import { populate } from './quiz-fixtures.ts'

for (const production of [true, false]) {
  test(
    `compiled main serves full authenticated Nest workflows and drains signals (production=${production})`,
    { timeout: 20000 },
    async () => {
      const directory = mkdtempSync(join(tmpdir(), 'nest-main-'))
      const provider = await oidcFixture()
      const shared = new LibraryRepository(join(directory, 'library.sqlite3'))
      populate(shared, 12)
      shared.close()
      const probe = createServer()
      await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve))
      const address = probe.address()
      assert.ok(address && typeof address !== 'string')
      const port = address.port
      await closeServer(probe)
      const origin = `http://127.0.0.1:${port}`
      const child = spawn(process.execPath, ['build/src/server/main.js'], {
        env: {
          ...process.env,
          NODE_ENV: production ? 'production' : 'development',
          STUDY_PORT: String(port),
          STUDY_HOST: '127.0.0.1',
          STUDY_ORIGIN: origin,
          STUDY_DB_PATH: join(directory, 'library.sqlite3'),
          STUDY_OIDC_ISSUER: provider.issuerIdentifier,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      const exit = once(child, 'exit')
      child.stderr.resume()
      let socket: WebSocket | undefined
      try {
        await new Promise<void>((resolve, reject) => {
          child.stdout.on('data', (chunk) => {
            if (String(chunk).includes('Certification Study Tool:')) {
              resolve()
            }
          })
          child.once('exit', () => reject(new Error('Main exited before listening')))
        })
        assert.equal((await fetch(origin + '/api/questions')).status, 401)
        const login = await fetch(origin + '/auth/login', { redirect: 'manual' })
        const loginCookie = login.headers.getSetCookie()[0]!.split(';')[0]!
        const authorization = await fetch(login.headers.get('location')!, { redirect: 'manual' })
        const callback = await fetch(authorization.headers.get('location')!, {
          redirect: 'manual',
          headers: { Cookie: loginCookie },
        })
        assert.equal(callback.status, 302)
        const cookie = callback.headers
          .getSetCookie()
          .find((value) => value.startsWith('study_session='))!
          .split(';')[0]!
        const session = await (
          await fetch(origin + '/api/session', { headers: { Cookie: cookie } })
        ).json()
        const headers = {
          Cookie: cookie,
          'X-Study-Account': session.user.id,
          Origin: origin,
          'Content-Type': 'application/json',
        }
        const questions = await fetch(origin + '/api/questions', { headers })
        assert.equal(questions.status, 200)
        const created = await fetch(origin + '/api/quizzes', {
          method: 'POST',
          headers,
          body: JSON.stringify({ sourceFilter: 'mixed', questionType: 'mixed' }),
        })
        assert.equal(created.status, 201)
        const quiz = await created.json()
        const path = origin + '/api/quizzes/' + quiz.id
        const submitted = await fetch(path + '/submit', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            answers: quiz.questions.map((question: { questionId: number }) => ({
              questionId: question.questionId,
              selected: [],
              confidence: null,
              flagged: false,
            })),
          }),
        })
        assert.equal(submitted.status, 200)
        assert.equal((await fetch(path, { method: 'DELETE', headers })).status, 200)
        assert.equal((await fetch(origin + '/study')).status, 200)
        if (!production) {
          const client = await fetch(origin + '/@vite/client')
          assert.equal(client.status, 200)
          assert.match(await client.text(), /WebSocket/)
          const source = await fetch(origin + '/src/web/main.tsx')
          assert.equal(source.status, 200)
          socket = new WebSocket(`ws://127.0.0.1:${port}/`, 'vite-hmr')
          await new Promise<void>((resolve, reject) => {
            socket!.addEventListener('open', () => resolve(), { once: true })
            socket!.addEventListener('error', () => reject(new Error('HMR failed')), { once: true })
          })
        }
        const closed =
          socket &&
          new Promise<void>((resolve) =>
            socket!.addEventListener('close', () => resolve(), { once: true }),
          )
        child.kill('SIGINT')
        child.kill('SIGTERM')
        const [code, signal] = await exit
        assert.equal(code, 0)
        assert.equal(signal, null)
        await closed
      } finally {
        socket?.close()
        if (child.exitCode === null && child.signalCode === null) {
          child.kill('SIGTERM')
        }
        await exit
        await closeServer(provider.server)
        rmSync(directory, { recursive: true, force: true })
      }
    },
  )
}

test(
  'early repeated signals wait for acquired Vite initialization without listening',
  { timeout: 15000 },
  async () => {
    const { writeFileSync } = await import('node:fs')
    const { resolve } = await import('node:path')
    const directory = mkdtempSync(join(tmpdir(), 'nest-main-early-'))
    writeFileSync(join(directory, 'index.html'), '<title>fixture</title>')
    writeFileSync(
      join(directory, 'vite.config.mjs'),
      `export default { plugins: [{ name: 'gated-startup', async configureServer() { process.once('SIGTERM', () => console.log('SIGNAL-OBSERVED')); console.log('VITE-GATED'); await new Promise(resolve => process.stdin.once('data', resolve)) } }] }`,
    )
    const portProbe = createServer()
    await new Promise<void>((resolve) => portProbe.listen(0, '127.0.0.1', resolve))
    const portAddress = portProbe.address()
    assert.ok(portAddress && typeof portAddress !== 'string')
    await closeServer(portProbe)
    const child = spawn(process.execPath, [resolve('build/src/server/main.js')], {
      cwd: directory,
      env: {
        ...process.env,
        NODE_ENV: 'development',
        STUDY_PORT: String(portAddress.port),
        STUDY_DB_PATH: join(directory, 'library.sqlite3'),
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    child.stderr.resume()
    const exit = once(child, 'exit')
    let output = ''
    try {
      await new Promise<void>((resolve, reject) => {
        child.stdout.on('data', (chunk) => {
          output += String(chunk)
          if (output.includes('VITE-GATED')) {
            resolve()
          }
        })
        child.once('exit', () => reject(new Error('Exited before gated Vite initialization')))
      })
      const signalled = new Promise<void>((resolve) => {
        child.stdout.on('data', (chunk) => {
          if (String(chunk).includes('SIGNAL-OBSERVED')) {
            resolve()
          }
        })
      })
      child.kill('SIGTERM')
      await signalled
      child.kill('SIGINT')
      child.stdin.end('release')
      const [code, signal] = await exit
      assert.equal(code, 0)
      assert.equal(signal, null)
      assert.doesNotMatch(output, /Certification Study Tool:/)
    } finally {
      child.stdin.end()
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGTERM')
      }
      await exit
      rmSync(directory, { recursive: true, force: true })
    }
  },
)

for (const missingStatic of [true, false]) {
  test(
    `main startup failure drains naturally (missingStatic=${missingStatic})`,
    { timeout: 15000 },
    async () => {
      const { resolve } = await import('node:path')
      const directory = mkdtempSync(join(tmpdir(), 'nest-main-failure-'))
      const occupied = createServer()
      await new Promise<void>((resolve) => occupied.listen(0, '127.0.0.1', resolve))
      const address = occupied.address()
      assert.ok(address && typeof address !== 'string')
      const child = spawn(process.execPath, [resolve('build/src/server/main.js')], {
        cwd: missingStatic ? directory : process.cwd(),
        env: {
          ...process.env,
          NODE_ENV: 'production',
          STUDY_HOST: '127.0.0.1',
          STUDY_PORT: String(address.port),
          STUDY_DB_PATH: join(directory, 'library.sqlite3'),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      let error = ''
      child.stdout.resume()
      child.stderr.on('data', (chunk) => {
        error += String(chunk)
      })
      try {
        const [code, signal] = await once(child, 'exit')
        assert.equal(code, 1)
        assert.equal(signal, null)
        assert.match(error, missingStatic ? /npm run build/ : /EADDRINUSE/)
        assert.doesNotMatch(error, /ERR_SERVER_NOT_RUNNING/)
      } finally {
        await closeServer(occupied)
        rmSync(directory, { recursive: true, force: true })
      }
    },
  )
}
