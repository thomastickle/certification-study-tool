import { prepareRuntimeDatabase } from './managed-database-fixture.ts'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { createServer, request } from 'node:http'
import { networkInterfaces, tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

// Exercise the actual entry point through a container-like, non-loopback connection.
test('server permits its configured Host but requires login for study data', async (t) => {
  const address = Object.values(networkInterfaces())
    .flat()
    .find((entry) => entry?.family === 'IPv4' && !entry.internal)?.address
  if (!address) {
    t.skip('No non-loopback IPv4 interface is available')
    return
  }
  const probe = createServer()
  await new Promise<void>((resolve) => probe.listen(0, '0.0.0.0', resolve))
  const socket = probe.address()
  assert.ok(socket && typeof socket !== 'string')
  const port = socket.port
  await new Promise<void>((resolve) => probe.close(() => resolve()))
  const directory = mkdtempSync(join(tmpdir(), 'study-listen-'))
  prepareRuntimeDatabase(join(directory, 'library.sqlite3'))
  const child = spawn(process.execPath, ['build/src/server/main.js'], {
    env: {
      ...process.env,
      NODE_ENV: 'development',
      STUDY_HOST: '0.0.0.0',
      STUDY_PORT: String(port),
      STUDY_DB_PATH: join(directory, 'library.sqlite3'),
      STUDY_ORIGIN: `http://localhost:${port}`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const exit = once(child, 'exit')
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Server startup timed out')), 10000)
      child.stdout.on('data', (chunk) => {
        if (String(chunk).includes('Certification Study Tool:')) {
          clearTimeout(timer)
          resolve()
        }
      })
      child.once('exit', () => {
        clearTimeout(timer)
        reject(new Error('Server exited before startup'))
      })
    })

    const status = (host: string, path = '/api/health') =>
      new Promise<number | undefined>((resolve, reject) => {
        const req = request(
          { hostname: address, port, path, headers: { Host: host } },
          (response) => {
            response.resume()
            resolve(response.statusCode)
          },
        )
        req.on('error', reject)
        req.end()
      })

    assert.equal(await status(`localhost:${port}`), 200)
    assert.equal(await status(`localhost:${port}`, '/api/questions'), 401)
    assert.equal(await status(`untrusted.example:${port}`), 403)
    for (const path of [
      '/api/../index.html',
      '/api/%2e%2e/index.html',
      '/api/./../index.html',
      `http://localhost:${port}/api/../index.html`,
    ]) {
      assert.equal(await status(`localhost:${port}`, path), 200, path)
      assert.equal(await status(`localhost:${port}`), 200, 'The server must remain alive')
    }
    assert.equal(await status(`localhost:${port}`, '/public/../api/questions'), 401)
    assert.equal(await status(`localhost:${port}`, '/api/../auth/logout'), 404)
    assert.equal(
      existsSync(join(directory, 'users')),
      false,
      'Anonymous requests must not create private databases',
    )
  } finally {
    child.kill('SIGTERM')
    await exit
    rmSync(directory, { recursive: true, force: true })
  }
})
