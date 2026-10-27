import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createServer, request } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'

test('compiled production runs without source files and preserves HTTP/static contracts', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'study-compiled-'))
  const reservation = createServer()
  await new Promise<void>((done) => reservation.listen(0, '127.0.0.1', done))
  const address = reservation.address()
  assert.ok(address && typeof address !== 'string')
  const port = address.port
  await new Promise<void>((done) => reservation.close(() => done()))
  cpSync('build/src', join(directory, 'build/src'), { recursive: true })
  cpSync('build/docs', join(directory, 'build/docs'), { recursive: true })
  symlinkSync(resolve('node_modules'), join(directory, 'node_modules'), 'dir')
  writeFileSync(join(directory, 'package.json'), '{"type":"module"}')
  mkdirSync(join(directory, 'dist'))
  writeFileSync(join(directory, 'dist/index.html'), '<!doctype html><title>Synthetic shell</title>')
  writeFileSync(join(directory, 'dist/probe.js'), '/* synthetic asset */')
  const child = spawn(process.execPath, ['build/src/server/main.js'], {
    cwd: directory,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      STUDY_HOST: '127.0.0.1',
      STUDY_PORT: String(port),
      STUDY_ORIGIN: `http://127.0.0.1:${port}`,
      STUDY_DB_PATH: join(directory, 'library.sqlite3'),
      STUDY_ACCOUNTS_PATH: join(directory, 'accounts.sqlite3'),
      STUDY_PRIVATE_LIBRARIES_DIR: join(directory, 'users'),
      STUDY_LEGACY_OWNER_SUBJECT: '',
      STUDY_OIDC_ISSUER: 'http://127.0.0.1:1/synthetic-issuer',
      STUDY_OIDC_CLIENT_ID: 'synthetic-client',
      STUDY_OIDC_CLIENT_SECRET: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const exit = once(child, 'exit')
  const deadline = setTimeout(() => child.kill('SIGKILL'), 30_000)
  let errors = ''
  child.stderr.on('data', (chunk) => (errors += String(chunk)))
  try {
    await new Promise<void>((done, reject) => {
      child.stdout.on('data', (chunk) => {
        if (String(chunk).includes('Certification Study Tool:')) {
          done()
        }
      })
      child.once('error', reject)
      child.once('exit', () => reject(new Error(`Entry point exited before startup: ${errors}`)))
    })

    const call = (path: string, method = 'GET') =>
      new Promise<{ status: number | undefined; body: string }>((done, reject) => {
        const options = {
          hostname: '127.0.0.1',
          port,
          path,
          method,
          headers: { Origin: `http://127.0.0.1:${port}` },
        }
        const req = request(options, (response) => {
          let body = ''
          response.setEncoding('utf8')
          response.on('data', (chunk) => (body += chunk))
          response.on('end', () => done({ status: response.statusCode, body }))
        })
        req.on('error', reject)
        req.end()
      })

    const health = await call('/api/health')
    assert.equal(health.status, 200)
    assert.deepEqual(JSON.parse(health.body), { status: 'ok' })
    assert.equal((await call('/api/questions')).status, 401)
    assert.deepEqual(JSON.parse((await call('/api/session')).body), { user: null })
    assert.match((await call('/')).body, /Synthetic shell/)
    assert.match((await call('/reports')).body, /Synthetic shell/)
    assert.match((await call('/api/%2e%2e/index.html')).body, /Synthetic shell/)
    assert.equal((await call('/public/../api/questions')).status, 401)
    assert.equal((await call('/api/../auth/logout')).status, 404)
    assert.equal((await call('/probe.js')).body, '/* synthetic asset */')
    assert.equal((await call('/missing.js')).status, 404)
    assert.deepEqual(await call('/', 'HEAD'), { status: 200, body: '' })
    assert.equal((await call('/', 'POST')).status, 405)
  } finally {
    child.kill('SIGTERM')
    const [code, signal] = await exit
    clearTimeout(deadline)
    rmSync(directory, { recursive: true, force: true })
    assert.equal(signal, null, errors)
    assert.equal(code, 0, errors)
  }
})
