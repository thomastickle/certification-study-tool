import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runtimeConfiguration } from '../../src/server/runtime-configuration.ts'
import assert from 'node:assert/strict'
import type { Server } from 'node:http'
import { request } from 'node:http'
import { test } from 'node:test'
import { createApplication } from '../../src/server/application.ts'

test('compiled Nest decorators serve health through DI and close the listening application', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'study-nest-'))
  const configuration = runtimeConfiguration({ STUDY_DB_PATH: join(directory, 'library.sqlite3') })
  const app = await createApplication(configuration)
  const server = app.getHttpServer() as Server
  try {
    await app.listen(0, '127.0.0.1')
    const address = server.address()
    assert.ok(address && typeof address !== 'string')
    configuration.origin.port = String(address.port)
    const response = await fetch(`http://127.0.0.1:${address.port}/api/health`, {
      headers: { Host: configuration.origin.host },
    })
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { status: 'ok' })

    // An eager Express JSON parser would return 400 before future guards could reject this.
    const status = await new Promise<number | undefined>((done, reject) => {
      const req = request(
        `http://127.0.0.1:${address.port}/api/health`,
        {
          method: 'POST',
          headers: {
            Host: configuration.origin.host,
            Origin: configuration.origin.origin,
            'Content-Type': 'application/json',
            'Content-Length': 1,
          },
        },
        (response) => {
          response.resume()
          response.on('end', () => done(response.statusCode))
        },
      )
      req.on('error', reject)
      req.end('{')
    })
    assert.equal(status, 401, 'Security must deny anonymous APIs before JSON parsing')
  } finally {
    await app.close()
    rmSync(directory, { recursive: true, force: true })
  }
  assert.equal(server.listening, false)
  assert.equal(server.address(), null)
})

test('factory rejects overlapping startup instead of running Nest initialization twice', async () => {
  const { Module } = await import('@nestjs/common')
  let enter!: () => void
  let release!: () => void
  const entered = new Promise<void>((resolve) => {
    enter = resolve
  })
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  let initializations = 0

  class StartupGate {
    async onModuleInit(): Promise<void> {
      initializations++
      enter()
      if (initializations > 1) {
        release()
      }
      await gate
    }
  }

  class GatedModule {}

  Module({ providers: [StartupGate] })(GatedModule)
  const directory = mkdtempSync(join(tmpdir(), 'study-startup-gate-'))
  const configuration = runtimeConfiguration({ STUDY_DB_PATH: join(directory, 'library.sqlite3') })
  const app = await createApplication(configuration, [GatedModule])
  const initializing = app.init()
  try {
    await entered
    await assert.rejects(app.init(), /startup is already in progress/)
    await assert.rejects(app.listen(0, '127.0.0.1'), /startup is already in progress/)
  } finally {
    release()
    await initializing
    await app.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
