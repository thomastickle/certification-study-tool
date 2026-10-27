import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { LibraryService } from '../src/server/questions/library-service.ts'
import { test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { answeredBenchmarkHistory } from './answered-benchmark-history.ts'
import { execFileSync } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { LibraryRepository } from '../src/server/questions/library-repository.ts'
import { QuizService } from '../src/server/quizzes/quiz-service.ts'
import { masteryHistory } from '../src/server/quizzes/mastery-history.ts'
import { sameCertification } from '../src/server/quizzes/certification-scope.ts'
import { QuizRepository } from '../src/server/quizzes/quiz-repository.ts'
import type { StoredQuiz } from '../src/server/quizzes/quiz-repository.ts'
import { populate } from './quiz-fixtures.ts'

const options = {
  sourceFilter: 'mixed',
  questionType: 'mixed',
  provider: 'AWS',
  certification: 'CLF-C02',
} as const

test('persisted evidence matches replay through restart, raw mutation, corruption and rollback', () => {
  const directory = mkdtempSync(join(tmpdir(), 'study-evidence-test-'))
  const path = join(directory, 'synthetic.sqlite3')
  let repository = new LibraryRepository(path)
  try {
    populate(repository)
    let now = Date.parse('2026-03-01T17:00:00Z')
    const service = new QuizService(
      repository,
      () => now,
      () => 0.2,
    )
    const first = service.start(options)
    const saved = repository.quizStore().find(first.id)!
    service.submit(first.id, {
      answers: first.questions.map((q, index) => ({
        ...q,
        selected: saved.keys[index]!.correct,
        confidence: 'Confident',
      })),
    })
    const expected = masteryHistory(repository.quizStore().completed())
    assert.deepEqual(repository.quizStore().studyHistory(options), expected)
    now += 8 * 86400000
    assert.equal(service.due(options).total, 20)
    repository.close()
    repository = new LibraryRepository(path)
    assert.deepEqual(repository.quizStore().studyHistory(options), expected)
    // Normal persisted reads cannot use the full-snapshot repository boundary.
    const store = repository.quizStore()
    store.completed = () => {
      throw new Error('Unexpected snapshot replay')
    }
    assert.deepEqual(store.studyHistory(options), expected)
    const sql = new DatabaseSync(path)
    try {
      sql.exec("UPDATE quiz_evidence SET payload = 'corrupt'")
      assert.deepEqual(store.studyHistory(options), expected)
      sql.exec('UPDATE quiz_evidence SET version = -1')
      assert.deepEqual(store.studyHistory(options), expected)
      sql.exec('DELETE FROM quiz_evidence')
      assert.deepEqual(store.studyHistory(options), expected)
      const changed = repository.quizStore().find(first.id)!
      changed.questions[0]!.correctAnswerIds = [999]
      sql
        .prepare('UPDATE quiz_sessions SET data = ? WHERE id = ?')
        .run(JSON.stringify(changed), first.id)
      assert.deepEqual(store.studyHistory(options), masteryHistory([changed]))
      assert.throws(
        () =>
          store.transaction(() => {
            store.remove(first.id)
            assert.equal(store.studyHistory(options).states.size, 0)
            throw new Error('rollback')
          }),
        /rollback/,
      )
      assert.deepEqual(store.studyHistory(options), masteryHistory([changed]))
      assert.throws(
        () =>
          store.transaction(() => {
            store.save(saved)
            throw new Error('rollback-save')
          }),
        /rollback-save/,
      )
      assert.deepEqual(store.studyHistory(options), masteryHistory([changed]))
      sql
        .prepare(
          "UPDATE quiz_sessions SET data = json_set(data, '$.id', 'embedded-id') WHERE id = ?",
        )
        .run(first.id)
      assert.deepEqual(
        store.studyHistory(options),
        masteryHistory(repository.quizStore().completed()),
      )
      sql
        .prepare(
          "UPDATE quiz_sessions SET data = json_set(data, '$.status', 'active') WHERE id = ?",
        )
        .run(first.id)
      assert.deepEqual(
        store.studyHistory(options),
        masteryHistory(repository.quizStore().completed()),
      )
      repository.annotateSnapshots((quiz) => {
        quiz.deletedBankNames = ['synthetic']
        return true
      })
      assert.equal(repository.quizStore().completed().length, 1)
      assert.equal(repository.quizStore().find(first.id)!.id, 'embedded-id')
      assert.deepEqual(
        store.studyHistory(options),
        masteryHistory(repository.quizStore().completed()),
      )
    } finally {
      sql.close()
    }
  } finally {
    repository.close()
    rmSync(directory, { recursive: true })
  }
})

/** Grade a genuine synthetic attempt, retaining shuffled keys and complete timing metadata. */
function completed(repository: LibraryRepository): StoredQuiz {
  const service = new QuizService(
    repository,
    () => Date.parse('2026-03-01T17:00:00Z'),
    () => 0.2,
  )
  const quiz = service.start(options)
  const stored = repository.quizStore().find(quiz.id)!
  service.submit(quiz.id, {
    answers: quiz.questions.map((q, i) => ({
      ...q,
      selected: stored.keys[i]!.correct,
      confidence: 'Confident',
    })),
  })
  return repository.quizStore().find(quiz.id)!
}

test('compact events preserve full replay for varied legacy, namespace, scoring and ordered evidence', () => {
  const repository = new LibraryRepository(':memory:')
  try {
    populate(repository)
    const template = completed(repository)
    const store = repository.quizStore()
    store.remove(template.id)
    const mutations: ((quiz: StoredQuiz) => void)[] = [
      () => {},
      (q) => {
        delete q.options.provider
        delete q.options.certification
      },
      (q) => {
        q.finishedAt = null
      },
      (q) => {
        q.finishedAt = q.startedAt - 1
      },
      (q) => {
        q.finishedAt = 1e20
      },
      (q) => {
        q.questions[0]!.correctAnswerIds = [999]
      },
      (q) => {
        q.keys[0]!.correct = [999]
      },
      (q) => {
        delete q.questions[0]!.correct
      },
      (q) => {
        delete (q.questions[0] as { confidence?: unknown }).confidence
      },
      (q) => {
        q.questions[0]!.answers.reverse()
      },
      (q) => {
        q.questions[0]!.selected = []
        q.questions[0]!.correct = false
      },
      (q) => {
        q.questions[0]!.selected = [999]
      },
      (q) => {
        q.questions[0]!.confidence = 'Unsure'
      },
      (q) => {
        q.questions[0]!.confidence = 'Educated Guess'
      },
      (q) => {
        q.questions[0]!.sourceId = 'private:1'
        q.keys[0]!.fingerprint = 'untrusted'
      },
      (q) => {
        q.options.provider = 'Other'
      },
      (q) => {
        q.options.certification = 'Other'
      },
      (q) => {
        q.questions.push(structuredClone(q.questions[0]!))
        q.keys.push(structuredClone(q.keys[0]!))
      },
    ]
    for (let index = 0; index < 90; index++) {
      const quiz = structuredClone(template)
      quiz.id = `attempt-${String(index).padStart(3, '0')}`
      const offset = (index % 20) * 86400000
      quiz.startedAt += offset
      quiz.finishedAt! += offset
      quiz.deadline += offset
      quiz.serverNow += offset
      mutations[index % mutations.length]!(quiz)
      store.save(quiz)
      for (const scope of [{}, { provider: 'Other' }, { certification: 'Other' }]) {
        const originalReplay = masteryHistory(
          store.completed().filter((q) => sameCertification(q.options, scope)),
        )
        assert.deepEqual(
          store.studyHistory(scope),
          originalReplay,
          `attempt ${index}, ${JSON.stringify(scope)}`,
        )
      }
    }
    const other = repository.forAccount('other').quizStore()
    assert.equal(other.studyHistory().states.size, 0)
    other.save({ ...template, id: template.id, options: { ...options, provider: 'Other' } })
    assert.equal(other.studyHistory().states.size, 0)
    assert.equal(other.studyHistory({ provider: 'Other' }).states.size, 20)
    const malformed = structuredClone(template)
    malformed.id = 'invalid-scope'
    malformed.options.provider = ''
    assert.doesNotThrow(
      () => store.save(malformed),
      'Storage must retain malformed legacy evidence',
    )
    assert.throws(() => store.studyHistory(), /non-empty/)
    store.remove(malformed.id)
    malformed.options.provider = 'AWS'
    malformed.id = 'invalid-content'
    malformed.questions = null as unknown as StoredQuiz['questions']
    store.save(malformed)
    assert.throws(() => store.studyHistory(), TypeError)
    assert.throws(() => masteryHistory(store.completed()), TypeError)
  } finally {
    repository.close()
  }
})

test('deleting an earlier event replays later successes, restore and unavailable due obligations', () => {
  const repository = new LibraryRepository(':memory:')
  try {
    populate(repository)
    const first = completed(repository)
    const store = repository.quizStore()
    const second = structuredClone(first)
    second.id = 'second'
    second.startedAt += 86400000
    second.finishedAt! += 86400000
    second.deadline += 86400000
    second.serverNow += 86400000
    store.save(second)
    const service = new QuizService(repository, () => second.finishedAt! + 8 * 86400000)
    assert.ok([...store.studyHistory().states.values()].every((s) => s.encounters === 2))
    service.deleteResult(first.id)
    assert.ok(
      [...store.studyHistory().states.values()].every(
        (s) => s.encounters === 1 && s.masteryOrigin === 'first',
      ),
    )
    assert.deepEqual(store.studyHistory(), masteryHistory(store.completed()))
    service.restoreResult(first.id)
    assert.deepEqual(store.studyHistory(), masteryHistory(store.completed()))
    const before = service.due(options)
    assert.equal(before.total, 20)
    for (const source of repository.sources()) {
      repository.deleteSource(source.id)
    }
    assert.deepEqual(service.due(options), { ...before, eligible: 0, unavailable: 20 })
    service.deleteResult(first.id, true)
    service.deleteResult(second.id)
    const expired = new QuizService(repository, () => second.finishedAt! + 11 * 86400000)
    expired.expireDue()
    assert.equal(store.studyHistory().states.size, 0)
  } finally {
    repository.close()
  }
})

test('projection write/rebuild failures roll back standalone saves and retain authoritative snapshots', () => {
  const directory = mkdtempSync(join(tmpdir(), 'study-evidence-atomic-'))
  const path = join(directory, 'synthetic.sqlite3')
  const repository = new LibraryRepository(path)
  const sql = new DatabaseSync(path)
  try {
    populate(repository)
    const quiz = completed(repository)
    const expected = repository.quizStore().find(quiz.id)
    const history = repository.quizStore().studyHistory()
    sql.exec(
      "CREATE TRIGGER fail_evidence BEFORE INSERT ON quiz_evidence BEGIN SELECT RAISE(ABORT, 'synthetic evidence failure'); END",
    )
    quiz.questions[0]!.correctAnswerIds = [999]
    assert.throws(() => repository.quizStore().save(quiz), /synthetic evidence failure/)
    assert.deepEqual(repository.quizStore().find(quiz.id), expected)
    assert.deepEqual(repository.quizStore().studyHistory(), history)
    sql.exec('DELETE FROM quiz_evidence')
    assert.throws(() => repository.quizStore().studyHistory(), /synthetic evidence failure/)
    assert.equal(sql.prepare('SELECT count(*) AS n FROM quiz_evidence').get()!.n, 0)
    sql.exec('DROP TRIGGER fail_evidence')
    assert.deepEqual(repository.quizStore().studyHistory(), history)
    sql.exec("UPDATE quiz_evidence SET provider = 'corrupt scope'")
    assert.deepEqual(
      repository.quizStore().studyHistory(),
      history,
      'Corrupt scope must not hide evidence',
    )
  } finally {
    sql.close()
    repository.close()
    rmSync(directory, { recursive: true })
  }
})

test('answered replay bounds timezone formatter construction across many scored events', (t) => {
  const repository = new LibraryRepository(':memory:')
  try {
    populate(repository)
    const template = completed(repository)
    const Formatter = Intl.DateTimeFormat
    let constructions = 0
    t.mock.method(
      Intl,
      'DateTimeFormat',
      function (...args: ConstructorParameters<typeof Intl.DateTimeFormat>) {
        constructions++
        return new Formatter(...args)
      },
    )
    const attempts = Array.from({ length: 20 }, (_, index) => ({
      ...structuredClone(template),
      id: `date-${index}`,
      finishedAt: template.finishedAt! + index * 86400000,
    }))
    const history = masteryHistory(attempts)
    assert.equal(history.states.size, 20)
    assert.ok(constructions <= 1, 'Replay must not construct an ICU formatter per scored encounter')
  } finally {
    repository.close()
  }
})

test('process exit inside a mutation transaction recovers snapshot and projection together', () => {
  const directory = mkdtempSync(join(tmpdir(), 'study-evidence-crash-'))
  const path = join(directory, 'synthetic.sqlite3')
  let repository = new LibraryRepository(path)
  try {
    populate(repository)
    const quiz = completed(repository)
    const history = repository.quizStore().studyHistory()
    repository.close()
    const module = new URL('../src/server/quizzes/quiz-repository.ts', import.meta.url).href
    for (const mutation of ['save', 'remove']) {
      const code = `
        import { DatabaseSync } from 'node:sqlite'
        import { QuizRepository } from ${JSON.stringify(module)}
        const db = new DatabaseSync(process.argv[1])
        const store = new QuizRepository(db)
        store.transaction(() => {
          const quiz = store.completed()[0]
          if (process.argv[2] === 'save') {
            quiz.questions[0].correctAnswerIds = [999]
            store.save(quiz)
          } else { store.remove(quiz.id) }
          process.exit(0)
        })
      `
      execFileSync(process.execPath, ['--input-type=module', '-e', code, path, mutation])
      repository = new LibraryRepository(path)
      assert.deepEqual(repository.quizStore().find(quiz.id), quiz)
      assert.deepEqual(repository.quizStore().studyHistory(), history)
      repository.close()
    }
    repository = new LibraryRepository(path)
  } finally {
    repository.close()
    rmSync(directory, { recursive: true })
  }
})

test('standalone initialization retries when its caller rolls back schema creation', () => {
  const db = new DatabaseSync(':memory:')
  try {
    db.exec(`CREATE TABLE quiz_sessions (
      account_id TEXT NOT NULL, id TEXT NOT NULL, status TEXT NOT NULL,
      started_at INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY (account_id, id)
    )`)
    db.exec('BEGIN')
    new QuizRepository(db)
    db.exec('ROLLBACK')
    assert.equal(new QuizRepository(db).studyHistory().states.size, 0)
  } finally {
    db.close()
  }
})

test('answered diverse fixture preserves large due sets and unavailable obligations', () => {
  const repository = new LibraryRepository(':memory:')
  try {
    populate(repository, 250)
    const template = completed(repository)
    const store = repository.quizStore()
    store.remove(template.id)
    const epoch = Date.parse('2026-03-15T17:00:00Z')
    store.transaction(() => {
      for (let sequence = 0; sequence < 50; sequence++) {
        const quiz = answeredBenchmarkHistory(template, sequence, epoch, 1000)
        quiz.id = `diverse-${sequence}`
        store.save(quiz)
      }
    })
    assert.deepEqual(store.studyHistory(), masteryHistory(store.completed()))
    const service = new QuizService(
      repository,
      () => epoch,
      () => 0.2,
    )
    const due = service.due(options)
    assert.ok(due.total >= 100)
    assert.equal(due.eligible, due.total)
    assert.equal(service.start({ ...options, mode: 'review' }).questions.length, 20)
    for (const source of repository.sources()) {
      repository.deleteSource(source.id)
    }
    assert.deepEqual(service.due(options), { ...due, eligible: 0, unavailable: due.total })
  } finally {
    repository.close()
  }
})

test('production provenance annotation retains valid evidence without hashing saved content', (t) => {
  const repository = new LibraryRepository(':memory:')
  try {
    populate(repository)
    const quiz = completed(repository)
    const history = repository.quizStore().studyHistory()
    const hashUpdates = t.mock.method(
      Object.getPrototypeOf(createHash('sha256')) as Pick<ReturnType<typeof createHash>, 'update'>,
      'update',
    )
    new LibraryService(repository).deleteSource(repository.sources()[0]!.id)
    const contentHashes = hashUpdates.mock.calls.filter((call) =>
      String(call.arguments[0]).includes('synthetic domain'),
    )
    assert.equal(contentHashes.length, 0, 'Provenance must not revalidate/hash saved questions')
    assert.deepEqual(repository.quizStore().find(quiz.id)!.deletedBankNames, ['quiz-synthetic'])
    assert.deepEqual(repository.quizStore().studyHistory(), history)
  } finally {
    repository.close()
  }
})

test('provenance annotation repairs invalid rows immediately and preserves row/account bindings', () => {
  const directory = mkdtempSync(join(tmpdir(), 'provenance-evidence-'))
  const path = join(directory, 'synthetic.sqlite3')
  const repository = new LibraryRepository(path)
  const sql = new DatabaseSync(path)
  try {
    populate(repository)
    const template = completed(repository)
    const source = repository.sources()[0]!

    const rows = () => sql.prepare('SELECT * FROM quiz_evidence ORDER BY account_id, id').all()

    const mutations = [
      'DELETE FROM quiz_evidence',
      'UPDATE quiz_evidence SET version = -1',
      "UPDATE quiz_evidence SET payload = 'corrupt'",
      "UPDATE quiz_evidence SET checksum = 'corrupt'",
      "UPDATE quiz_evidence SET provider = 'Other'",
      "UPDATE quiz_evidence SET certification = 'Other'",
      "UPDATE quiz_evidence SET account_id = 'other'",
      "UPDATE quiz_evidence SET id = 'other-row'",
    ]
    for (const mutation of mutations) {
      sql.exec('DELETE FROM quiz_evidence')
      repository.quizStore().save(template)
      const expected = rows()[0]
      sql.exec(mutation)
      repository.annotateDeletedBanks([{ ...source, sourceId: source.id }])
      assert.deepEqual(
        sql
          .prepare("SELECT * FROM quiz_evidence WHERE account_id = 'local' AND id = ?")
          .get(template.id),
        expected,
        `Rebuild before the next read: ${mutation}`,
      )
      assert.deepEqual(
        repository.quizStore().studyHistory(),
        masteryHistory(repository.quizStore().completed()),
      )
    }
    // A raw writer changes both row identity and owner independently of the embedded attempt ID.
    sql.exec("UPDATE quiz_sessions SET id = 'row-id', account_id = 'alice'")
    const alice = repository.forAccount('alice').quizStore()
    assert.deepEqual(alice.studyHistory(), masteryHistory(alice.completed()))
    const before = rows()
    repository.annotateDeletedBanks([{ ...source, sourceId: source.id }])
    assert.deepEqual(rows(), before)
    assert.equal(alice.find('row-id')!.id, template.id)
    assert.equal(repository.quizStore().studyHistory().states.size, 0)
    assert.deepEqual(alice.studyHistory(), masteryHistory(alice.completed()))
  } finally {
    sql.close()
    repository.close()
    rmSync(directory, { recursive: true })
  }
})

test('generic annotation callbacks cannot bless changed extraction inputs', () => {
  const repository = new LibraryRepository(':memory:')
  try {
    populate(repository)
    const template = completed(repository)
    const mutations: ((quiz: StoredQuiz) => void)[] = [
      (q) => {
        q.questions[0]!.selected = []
        q.questions[0]!.correct = false
      },
      (q) => {
        q.questions[0]!.confidence = 'Unsure'
      },
      (q) => {
        q.questions[0]!.question = 'Changed content'
      },
      (q) => {
        q.questions[0]!.answers[0]!.text = 'Changed answer'
      },
      (q) => {
        q.keys[0]!.correct = [999]
      },
      (q) => {
        q.questions[0]!.correctAnswerIds = [999]
      },
      (q) => {
        q.startedAt = q.finishedAt! + 1
      },
      (q) => {
        q.finishedAt! += 86400000
      },
      (q) => {
        q.status = 'active'
      },
      (q) => {
        q.id = 'changed-embedded-id'
      },
      (q) => {
        q.options.provider = 'Other'
      },
      (q) => {
        q.options.certification = 'Other'
      },
      (q) => {
        delete q.questions[0]!.correct
      },
    ]
    for (const mutate of mutations) {
      repository.quizStore().save(template)
      repository.annotateSnapshots((quiz) => {
        mutate(quiz)
        return true
      })
      for (const scope of [options, { provider: 'Other' }, { certification: 'Other' }]) {
        const snapshots = repository
          .quizStore()
          .completed()
          .filter((q) => sameCertification(q.options, scope))
        assert.deepEqual(repository.quizStore().studyHistory(scope), masteryHistory(snapshots))
      }
    }
  } finally {
    repository.close()
  }
})

test('retained and rebuilt annotation writes roll back standalone and enclosing transactions', () => {
  const directory = mkdtempSync(join(tmpdir(), 'provenance-rollback-'))
  const path = join(directory, 'synthetic.sqlite3')
  const repository = new LibraryRepository(path)
  const sql = new DatabaseSync(path)
  try {
    populate(repository)
    const quiz = completed(repository)
    const source = repository.sources()[0]!

    const annotate = () => repository.annotateDeletedBanks([{ ...source, sourceId: source.id }])

    const snapshot = repository.quizStore().find(quiz.id)

    const rows = () => sql.prepare('SELECT * FROM quiz_evidence').all()

    for (const missing of [false, true]) {
      if (missing) {
        sql.exec('DELETE FROM quiz_evidence')
      }
      const before = rows()
      sql.exec(
        "CREATE TRIGGER fail_annotation BEFORE INSERT ON quiz_evidence BEGIN SELECT RAISE(ABORT, 'annotation failure'); END",
      )
      assert.throws(annotate, /annotation failure/)
      assert.deepEqual(repository.quizStore().find(quiz.id), snapshot)
      assert.deepEqual(rows(), before)
      assert.throws(
        () => new LibraryService(repository).deleteSource(source.id),
        /annotation failure/,
      )
      assert.equal(repository.sources().length, 1)
      assert.deepEqual(repository.quizStore().find(quiz.id), snapshot)
      assert.deepEqual(rows(), before)
      sql.exec('DROP TRIGGER fail_annotation')
      assert.throws(
        () =>
          repository.transaction(() => {
            annotate()
            throw new Error('outer rollback')
          }),
        /outer rollback/,
      )
      assert.deepEqual(repository.quizStore().find(quiz.id), snapshot)
      assert.deepEqual(rows(), before)
    }
    annotate()
    assert.equal(
      rows().length,
      1,
      'Successful standalone annotation eagerly repairs missing evidence',
    )
  } finally {
    sql.close()
    repository.close()
    rmSync(directory, { recursive: true })
  }
})

test('legacy source pinning preserves unknown scoring, sentinels and historical scope errors', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'provenance-legacy-'))
  const path = join(directory, 'synthetic.sqlite3')
  const repository = new LibraryRepository(path)
  const sql = new DatabaseSync(path)
  try {
    populate(repository)
    const quiz = completed(repository)
    delete quiz.questions[0]!.correct
    for (const question of quiz.questions) {
      delete question.sourceId
    }
    repository.quizStore().save(quiz)
    const source = repository.sources()[0]!
    const before = sql.prepare('SELECT * FROM quiz_evidence').all()
    const history = repository.quizStore().studyHistory()
    const hashUpdates = t.mock.method(
      Object.getPrototypeOf(createHash('sha256')) as Pick<ReturnType<typeof createHash>, 'update'>,
      'update',
    )
    new LibraryService(repository).deleteSource(source.id)
    assert.equal(
      hashUpdates.mock.calls.filter((call) =>
        String(call.arguments[0]).includes('synthetic domain'),
      ).length,
      0,
    )
    assert.deepEqual(sql.prepare('SELECT * FROM quiz_evidence').all(), before)
    assert.ok(
      repository
        .quizStore()
        .find(quiz.id)!
        .questions.every((q) => q.sourceId === source.id),
    )
    assert.deepEqual(repository.quizStore().studyHistory(), history)
    // A SQL/embedded-status mismatch must remain unknown, rather than upgrading to scored evidence.
    sql.exec("UPDATE quiz_sessions SET data = json_set(data, '$.status', 'active')")
    const unknown = repository.quizStore().studyHistory()
    repository.annotateDeletedBanks([{ ...source, sourceId: source.id }])
    assert.deepEqual(repository.quizStore().studyHistory(), unknown)
    // Existing invalid-scope errors still escape annotation before any snapshot is written.
    sql.exec("UPDATE quiz_sessions SET data = json_set(data, '$.options.provider', '')")
    assert.throws(
      () => repository.annotateDeletedBanks([{ ...source, sourceId: source.id }]),
      /non-empty/,
    )
    assert.throws(() => repository.quizStore().studyHistory(), /non-empty/)
  } finally {
    sql.close()
    repository.close()
    rmSync(directory, { recursive: true })
  }
})
