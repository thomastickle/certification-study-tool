import assert from 'node:assert/strict'
import { test } from 'node:test'
import { HomeService } from '../src/server/home/home-service.ts'
import { ImportService } from '../src/server/importer/import-service.ts'
import { LibraryRepository } from '../src/server/questions/library-repository.ts'
import { bank } from './fixtures.ts'
import { homeExam, homeNow } from './home-fixtures.ts'
import { readinessScore } from '../src/server/home/readiness.ts'

test('home groups real library certifications by provider, not one track per bank', () => {
  const repository = new LibraryRepository(':memory:')
  try {
    const importer = new ImportService(repository)
    for (const [key, provider, code, name] of [
      ['aws-one', 'AWS', 'CLF-C02', 'Cloud Practitioner'],
      ['aws-two', 'AWS', 'CLF-C02', 'Cloud Practitioner'],
      ['aws-other', 'AWS', 'OTHER-1', 'Another track'],
      ['example', 'Example', 'DEMO-1', 'Example track'],
    ]) {
      const input = bank(key)
      input.certification = { provider: provider!, code: code!, name: name! }
      importer.confirm(input, importer.preview(input).token, false)
    }
    const home = new HomeService(repository).get()
    assert.deepEqual(
      home.providers.map((provider) => [provider.name, provider.total]),
      [
        ['AWS', 2],
        ['Example', 1],
      ],
    )
    const aws = home.providers[0]!
    assert.equal(aws.ready, 0)
    assert.equal(aws.certifications[0]!.sourceIds.length, 2)
    assert.equal(aws.certifications[0]!.readiness.status, 'insufficient')
    assert.equal(aws.certifications[1]!.readiness.status, 'unsupported')
    assert.equal(aws.certifications[1]!.readiness.score, null)
    assert.doesNotMatch(JSON.stringify(home), /Which option|Example A|fingerprint|mastery:v1/)
  } finally {
    repository.close()
  }
})

test('combined scores preserve the worked color boundaries and cap an optimistic blend', () => {
  for (const [mastery, domain, exams, score, status] of [
    [62, 55, [64, 67, 70], 62, 'red'],
    [88, 80, [83, 87, 90], 85, 'yellow'],
    [98, 62, [96, 97, 98], 88, 'yellow'],
    [98, 97, [86, 99, 100], 94, 'yellow'],
    [98, 96, [96, 97, 98], 97, 'green'],
    [80, 80, [80, 80, 80], 80, 'yellow'],
    [95, 95, [95, 95, 95], 95, 'green'],
    [79.9, 79.9, [79.9, 79.9, 79.9], 79, 'red'],
  ] as const) {
    const result = readinessScore(mastery, domain, [...exams])
    assert.equal(result.score, score)
    assert.equal(result.status, status)
  }
})

test('weak domains cap a high blended score and skips remain scored misses', () => {
  const repository = new LibraryRepository(':memory:')
  try {
    for (const age of [3, 2, 1]) {
      const exam = homeExam(`cap-${age}`, age, age === 1 ? 62 : 65)
      if (age === 1) {
        for (const question of exam.questions.slice(62)) {
          question.selected = []
        }
      }
      repository.quizStore().save(exam)
    }
    const readiness = new HomeService(repository, () => homeNow).get().providers[0]!
      .certifications[0]!.readiness
    // Skips reduce domain/exam scores but are outside the answered mastery denominator.
    assert.equal(readiness.mastery, 100)
    assert.equal(readiness.blendedScore, 96)
    assert.equal(readiness.score, 94)
    assert.equal(readiness.status, 'yellow')
    assert.equal(readiness.domains[3]!.score, 87.5)
    assert.match(readiness.reasons.join(' '), /every domain/)
  } finally {
    repository.close()
  }
})

test('same-day retries, pauses, short exams, stale and future results do not establish readiness', () => {
  for (const scenario of [
    'same-day',
    'paused',
    'short',
    'stale',
    'future',
    'unknown-confidence',
  ] as const) {
    const repository = new LibraryRepository(':memory:')
    try {
      for (const age of [3, 2, 1]) {
        const exam = homeExam(`${scenario}-${age}`, scenario === 'same-day' ? 1 : age)
        if (scenario === 'paused') {
          exam.pauseHistory!.intervals.push({
            startedAt: exam.startedAt,
            endedAt: exam.startedAt + 1000,
            cause: 'manual',
          })
        } else if (scenario === 'short') {
          exam.questions = exam.questions.slice(0, 20)
          exam.keys = exam.keys.slice(0, 20)
          exam.total = exam.correctCount = 20
        } else if (scenario === 'stale' || scenario === 'future') {
          const shift = scenario === 'stale' ? -31 * 86400000 : 10 * 86400000
          exam.startedAt += shift
          exam.deadline += shift
          exam.finishedAt! += shift
        } else if (scenario === 'unknown-confidence') {
          delete (exam.questions[0] as unknown as Record<string, unknown>).confidence
        }
        repository.quizStore().save(exam)
      }
      const readiness = new HomeService(repository, () => homeNow).get().providers[0]
        ?.certifications[0]?.readiness
      if (scenario === 'future') {
        assert.equal(readiness, undefined, 'future snapshots supply no current evidence')
      } else {
        assert.equal(readiness?.status, 'insufficient', scenario)
        assert.equal(readiness.score, null)
        assert.ok(readiness.reasons.length)
      }
    } finally {
      repository.close()
    }
  }
})

test('replaying an identical exam cannot qualify through broad quiz coverage', () => {
  const repository = new LibraryRepository(':memory:')
  try {
    for (const age of [8, 7, 6]) {
      const quiz = homeExam(`coverage-${age}`, age)
      quiz.mode = quiz.options.mode = 'quiz'
      repository.quizStore().save(quiz)
    }
    for (const age of [3, 2, 1]) {
      repository.quizStore().save(homeExam(`repeat-${age}`, age, 65, 'same-exam'))
    }
    const readiness = new HomeService(repository, () => homeNow).get().providers[0]!
      .certifications[0]!.readiness
    assert.ok(readiness.domains.every((domain) => domain.distinctAnswered >= 20))
    assert.equal(readiness.exams.length, 3)
    assert.equal(readiness.status, 'insufficient')
    assert.match(readiness.reasons.join(' '), /at least 13 questions/)
  } finally {
    repository.close()
  }
})

test('a same-day excellent retry does not hide a poor exam on that study day', () => {
  const repository = new LibraryRepository(':memory:')
  try {
    for (const age of [3, 2, 1]) {
      repository.quizStore().save(homeExam(`good-${age}`, age))
    }
    repository.quizStore().save(homeExam('bad-retry', 1, 32))
    const readiness = new HomeService(repository, () => homeNow).get().providers[0]!
      .certifications[0]!.readiness
    assert.equal(readiness.exams[0]!.score, (32 / 65) * 100)
    assert.notEqual(readiness.status, 'green')
  } finally {
    repository.close()
  }
})

test('broad, consistent recent exams make a single historical certification exam-ready', () => {
  const repository = new LibraryRepository(':memory:')
  try {
    for (const age of [3, 2, 1]) {
      repository.quizStore().save(homeExam(`exam-${age}`, age))
    }
    const summary = new HomeService(repository, () => homeNow).get()
    const aws = summary.providers[0]!
    assert.ok(aws, 'completed history keeps the certification on Home')
    assert.equal(aws.name, 'AWS')
    assert.equal(aws.total, 1, 'deleting banks does not erase the historical certification')
    assert.equal(aws.ready, 1)
    const readiness = aws.certifications[0]!.readiness
    assert.equal(readiness.status, 'green')
    assert.equal(readiness.score, 100)
    assert.equal(readiness.mastery, 100)
    assert.equal(readiness.examAverage, 100)
    assert.deepEqual(
      readiness.domains.map((domain) => domain.distinctAnswered),
      [48, 57, 66, 24],
    )
    assert.equal(readiness.exams.length, 3)
    assert.equal(readiness.reasons.length, 0)
    assert.doesNotMatch(JSON.stringify(summary), /Synthetic readiness|synthetic-private|mastery:v1/)
  } finally {
    repository.close()
  }
})
