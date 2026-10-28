import 'reflect-metadata'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mock, test } from 'node:test'
import { NestFactory } from '@nestjs/core'
import { ApplicationRuntime } from '../../src/server/runtime/application-runtime.ts'
import { ApplicationAuthentication } from '../../src/server/auth/application-authentication.ts'
import { ImportPreviews } from '../../src/server/importer/import-previews.ts'
import { PrivateLibraries } from '../../src/server/questions/private-libraries.ts'
import { StudyHousekeeping } from '../../src/server/questions/study-housekeeping.ts'
import { StudyLibraryScope } from '../../src/server/runtime/study-library-scope.ts'
import {
  runtimeConfiguration,
  RUNTIME_CONFIGURATION,
} from '../../src/server/runtime/runtime-configuration.ts'
import {
  RuntimeModule,
  SHARED_LIBRARY_REPOSITORY,
} from '../../src/server/runtime/runtime.module.ts'

/** All implicit account/private paths must derive from the fixture shared path. */
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'study-runtime-'))
  const configuration = runtimeConfiguration({ STUDY_DB_PATH: join(directory, 'library.sqlite3') })
  return { directory, configuration }
}

test('configured Nest graph has one singleton owner, secure migrated files, and transport-safe hooks', async () => {
  const { directory, configuration } = fixture()
  const app = await NestFactory.createApplicationContext(RuntimeModule.register(configuration), {
    logger: false,
    abortOnError: false,
  })
  const runtime = app.get(ApplicationRuntime)
  try {
    assert.equal(app.get(RUNTIME_CONFIGURATION), configuration)
    assert.equal(app.get(ApplicationAuthentication), runtime.authentication)
    assert.equal(app.get(SHARED_LIBRARY_REPOSITORY), runtime.sharedLibrary)
    assert.equal(app.get(ImportPreviews), runtime.previews)
    assert.equal(app.get(PrivateLibraries), runtime.privateLibraries)
    assert.equal(app.get(StudyHousekeeping), runtime.housekeeping)
    assert.equal(app.get(StudyLibraryScope), runtime.studyLibraries)
    assert.equal(statSync(configuration.databasePath).mode & 0o777, 0o600)
    assert.equal(statSync(configuration.authentication.accountsPath).mode & 0o777, 0o600)
    let drained = 0
    runtime.attachTransport(async () => {
      runtime.sharedLibrary.quizStore().nextHousekeepingAt()
      runtime.authentication.legacyOwnerId('during-drain')
      drained++
    })
    await runtime.onModuleDestroy()
    runtime.sharedLibrary.quizStore().nextHousekeepingAt()
    await app.close()
    await app.close()
    assert.equal(drained, 1)
    assert.throws(() => runtime.sharedLibrary.quizStore().nextHousekeepingAt(), /closed|not open/)
    assert.throws(() => runtime.authentication.legacyOwnerId('after-close'), /closed|not open/)
  } finally {
    await app.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('a failing transport drain still releases both database roots', async () => {
  const { directory, configuration } = fixture()
  const app = await NestFactory.createApplicationContext(RuntimeModule.register(configuration), {
    logger: false,
    abortOnError: false,
  })
  const runtime = app.get(ApplicationRuntime)
  try {
    runtime.attachTransport(async () => {
      throw new Error('transport failed')
    })
    // Nest reports hook errors and continues shutdown rather than rejecting close().
    await app.close()
    assert.throws(() => runtime.sharedLibrary.quizStore().nextHousekeepingAt(), /closed|not open/)
    assert.throws(() => runtime.authentication.legacyOwnerId('after-close'), /closed|not open/)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('provider readiness waits for startup upkeep', async () => {
  const { directory, configuration } = fixture()
  let release!: () => void
  const deferred = new Promise<void>((resolve) => {
    release = resolve
  })
  const tick = mock.method(StudyHousekeeping.prototype, 'tick', () => deferred)
  const stop = mock.method(StudyHousekeeping.prototype, 'stop', async () => {})
  let ready = false
  const creating = ApplicationRuntime.create(configuration).then((runtime) => {
    ready = true
    return runtime
  })
  try {
    await Promise.resolve()
    assert.equal(ready, false)
    release()
    const runtime = await creating
    await runtime.onModuleDestroy()
    runtime.onApplicationShutdown()
    assert.equal(stop.mock.callCount(), 1)
  } finally {
    tick.mock.restore()
    stop.mock.restore()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('corrupt account construction releases its SQLite handle', async () => {
  const { directory, configuration } = fixture()
  const { writeFileSync } = await import('node:fs')
  const { DatabaseSync } = await import('node:sqlite')
  writeFileSync(configuration.authentication.accountsPath, 'corrupt fixture')
  const opened = new Set<InstanceType<typeof DatabaseSync>>()
  const originalPrepare = DatabaseSync.prototype.prepare
  const prepare = mock.method(
    DatabaseSync.prototype,
    'prepare',
    function (
      this: InstanceType<typeof DatabaseSync>,
      ...args: Parameters<typeof originalPrepare>
    ) {
      opened.add(this)
      return originalPrepare.apply(this, args)
    },
  )
  try {
    await assert.rejects(ApplicationRuntime.create(configuration), /not a database/)
    assert.ok(opened.size > 0)
    for (const db of opened) {
      assert.equal(db.isOpen, false, 'failed initialization must release acquired handles')
    }
  } finally {
    prepare.mock.restore()
    rmSync(directory, { recursive: true, force: true })
  }
})

for (const phase of ['mapping', 'chmod', 'migration', 'upkeep', 'unsupported-shared'] as const) {
  test(`failed ${phase} initialization closes all acquired SQLite connections`, async () => {
    const { directory, configuration } = fixture()
    const fs = await import('node:fs')
    const { syncBuiltinESMExports } = await import('node:module')
    const { DatabaseSync } = await import('node:sqlite')
    const opened = new Set<InstanceType<typeof DatabaseSync>>()
    const originalPrepare = DatabaseSync.prototype.prepare
    const prepare = mock.method(
      DatabaseSync.prototype,
      'prepare',
      function (
        this: InstanceType<typeof DatabaseSync>,
        ...args: Parameters<typeof originalPrepare>
      ) {
        opened.add(this)
        return originalPrepare.apply(this, args)
      },
    )

    let restore = () => {}

    if (phase === 'mapping') {
      configuration.legacyOwnerSubject = '   '
    } else if (phase === 'chmod') {
      const originalChmod = fs.default.chmodSync
      const chmod = mock.method(
        fs.default,
        'chmodSync',
        (...args: Parameters<typeof originalChmod>) => {
          if (args[0] === configuration.databasePath) {
            throw new Error('injected chmod failure')
          }
          return originalChmod(...args)
        },
      )
      syncBuiltinESMExports()
      restore = () => {
        chmod.mock.restore()
        syncBuiltinESMExports()
      }
    } else if (phase === 'migration') {
      const migration = mock.method(PrivateLibraries.prototype, 'migrateFrom', () => {
        throw new Error('injected migration failure')
      })
      restore = () => migration.mock.restore()
    } else if (phase === 'upkeep') {
      const tick = mock.method(StudyHousekeeping.prototype, 'tick', async () => {
        throw new Error('injected upkeep failure')
      })
      restore = () => tick.mock.restore()
    } else {
      const db = new DatabaseSync(configuration.databasePath)
      db.exec('PRAGMA application_id = 1096242004; PRAGMA user_version = 999;')
      db.close()
    }
    try {
      await assert.rejects(ApplicationRuntime.create(configuration), /legacy|injected|Unsupported/i)
      assert.ok(opened.size > 0)
      for (const db of opened) {
        assert.equal(db.isOpen, false)
      }
    } finally {
      restore()
      prepare.mock.restore()
      rmSync(directory, { recursive: true, force: true })
    }
  })
}

test('Nest shutdown awaits background drain before transport and database closure', async () => {
  const { directory, configuration } = fixture()
  const app = await NestFactory.createApplicationContext(RuntimeModule.register(configuration), {
    logger: false,
    abortOnError: false,
  })
  const runtime = app.get(ApplicationRuntime)
  let release!: () => void
  const deferred = new Promise<void>((resolve) => {
    release = resolve
  })
  const stop = mock.method(runtime.housekeeping, 'stop', () => deferred)
  let transportDrained = false
  runtime.attachTransport(async () => {
    transportDrained = true
  })
  try {
    const closing = app.close()
    await Promise.resolve()
    assert.equal(transportDrained, false)
    runtime.sharedLibrary.quizStore().nextHousekeepingAt()
    release()
    await closing
    await app.close()
    assert.equal(stop.mock.callCount(), 1)
    assert.equal(transportDrained, true)
    assert.throws(() => runtime.sharedLibrary.quizStore().nextHousekeepingAt(), /closed|not open/)
  } finally {
    release()
    stop.mock.restore()
    await app.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('Nest readiness includes explicit owner migration and startup expiry before any transport', async () => {
  const { directory, configuration } = fixture()
  const { DatabaseSync } = await import('node:sqlite')
  const { LibraryRepository } = await import('../../src/server/questions/library-repository.ts')
  const { QuizService } = await import('../../src/server/quizzes/quiz-service.ts')
  const { populate } = await import('../quiz-fixtures.ts')
  const { legacyStudySchema } = await import('../legacy-study-schema.ts')
  const shared = new LibraryRepository(configuration.databasePath)
  populate(shared)
  const quiz = new QuizService(shared, () => Date.now() - 30 * 60_000).start({
    sourceFilter: 'mixed',
    questionType: 'mixed',
  })
  shared.close()
  const db = new DatabaseSync(configuration.databasePath)
  db.exec(legacyStudySchema)
  db.close()
  configuration.legacyOwnerSubject = 'synthetic-legacy-owner'
  const app = await NestFactory.createApplicationContext(RuntimeModule.register(configuration), {
    logger: false,
    abortOnError: false,
  })
  try {
    const runtime = app.get(ApplicationRuntime)
    const accountId = runtime.authentication.legacyOwnerId(configuration.legacyOwnerSubject)
    const personal = runtime.privateLibraries.open(accountId)
    try {
      assert.equal(personal.quizStore().find(quiz.id)!.status, 'completed')
      assert.equal(runtime.sharedLibrary.quizStore().find(quiz.id), undefined)
      assert.equal(statSync(configuration.privateLibrariesDirectory).mode & 0o777, 0o700)
      assert.equal(
        statSync(join(configuration.privateLibrariesDirectory, `${accountId}.sqlite3`)).mode &
          0o777,
        0o600,
      )
    } finally {
      personal.close()
    }
  } finally {
    await app.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
