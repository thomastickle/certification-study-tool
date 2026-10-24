import assert from 'node:assert/strict'
import { test } from 'node:test'
import { HomeService } from '../src/server/home/home-service.ts'
import { LibraryRepository } from '../src/server/questions/library-repository.ts'
import { homeExam, homeNow } from './home-fixtures.ts'

/** Generic snapshots deliberately have no AWS domains or classifications. */
function saveExams(repository: LibraryRepository, provider: string, code: string, correct: number) {
  for (const age of [3, 2, 1]) {
    const exam = homeExam(`${provider}-${code}-${age}`, age, correct)
    exam.options = { ...exam.options, provider, certification: code }
    for (const question of exam.questions) {
      question.domain = 0
    }
    repository.quizStore().save(exam)
  }
}

test('Home assesses any certification from its own generic exam evidence without AWS domains', () => {
  const repository = new LibraryRepository(':memory:')
  try {
    saveExams(repository, 'Azure', 'AZ-900', 65)
    saveExams(repository, 'GCP', 'CDL', 55)
    saveExams(repository, 'Custom', 'MY-EXAM', 35)
    const home = new HomeService(repository, () => homeNow).get()
    for (const [provider, status, score] of [
      ['Azure', 'green', 100],
      ['GCP', 'yellow', 84],
      ['Custom', 'red', 53],
    ] as const) {
      const readiness = home.providers.find((group) => group.name === provider)!.certifications[0]!
        .readiness
      assert.equal(readiness.status, status)
      assert.equal(readiness.score, score)
      assert.equal(readiness.basis, 'practice')
      assert.deepEqual(
        readiness.domains.map((domain) => domain.name),
        ['All practice questions'],
      )
    }
  } finally {
    repository.close()
  }
})

test('generic tracks keep insufficient evidence neutral and never borrow another track history', () => {
  const repository = new LibraryRepository(':memory:')
  try {
    saveExams(repository, 'Azure', 'AZ-900', 65)
    const exam = homeExam('gcp-one', 1)
    exam.options = { ...exam.options, provider: 'GCP', certification: 'CDL' }
    repository.quizStore().save(exam)
    const readiness = new HomeService(repository, () => homeNow)
      .get()
      .providers.find((group) => group.name === 'GCP')!.certifications[0]!.readiness
    assert.equal(readiness.status, 'insufficient')
    assert.equal(readiness.score, null)
    assert.match(readiness.reasons.join(' '), /80 distinct|65\/80/)
    assert.equal(readiness.exams.length, 1)
  } finally {
    repository.close()
  }
})

test('generic estimates reject replayed, paused, stale and malformed exam evidence', () => {
  for (const scenario of ['replay', 'paused', 'stale', 'short', 'unscored'] as const) {
    const repository = new LibraryRepository(':memory:')
    try {
      for (const age of [3, 2, 1]) {
        const exam = homeExam(
          `generic-${scenario}-${age}`,
          scenario === 'stale' ? 40 + age : age,
          65,
          scenario === 'replay' ? 'repeated' : `${scenario}-${age}`,
        )
        exam.options = { ...exam.options, provider: 'Custom', certification: 'TEST' }
        if (scenario === 'paused') {
          exam.pauseHistory!.intervals.push({
            startedAt: exam.startedAt,
            endedAt: exam.startedAt + 1000,
            cause: 'manual',
          })
        }
        if (scenario === 'short') {
          exam.total = 20
          exam.questions = exam.questions.slice(0, 20)
          exam.keys = exam.keys.slice(0, 20)
          exam.correctCount = 20
        }
        if (scenario === 'unscored') {
          exam.questions[0]!.correct = false
        }
        repository.quizStore().save(exam)
      }
      const readiness = new HomeService(repository, () => homeNow).get().providers[0]!
        .certifications[0]!.readiness
      assert.equal(readiness.status, 'insufficient', scenario)
      assert.equal(readiness.score, null, scenario)
    } finally {
      repository.close()
    }
  }
})
