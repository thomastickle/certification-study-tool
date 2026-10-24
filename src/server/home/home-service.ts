import type { CertificationProgress, HomeSummary } from '../../shared/home-contracts.ts'
import type { LibraryRepository } from '../questions/library-repository.ts'
import { certificationReadiness, emptyReadiness } from './readiness.ts'
import { masteryHistory } from '../quizzes/mastery-history.ts'
import { studyDay } from '../quizzes/mastery.ts'
import { ApplicationError } from '../errors.ts'
import { certificationScope, isClf } from '../quizzes/certification-scope.ts'
import type { StoredQuiz } from '../quizzes/quiz-repository.ts'

/** Supply the home screen with certification-level aggregates only. */
export class HomeService {
  private repository: LibraryRepository
  private now: () => number

  constructor(repository: LibraryRepository, now = Date.now) {
    this.repository = repository
    this.now = now
  }

  /** Group tracked certifications without exposing question content. */
  get(): HomeSummary {
    const now = this.now()
    const completed = this.repository
      .quizStore()
      .completed()
      .filter((quiz) => Number.isFinite(quiz.finishedAt) && quiz.finishedAt! <= now)
    const tracks = new Map<string, CertificationProgress>()
    for (const source of this.repository.sources()) {
      const key = JSON.stringify([source.provider, source.certification])
      let track = tracks.get(key)
      if (!track) {
        track = {
          provider: source.provider,
          code: source.certification,
          name: source.certificationName,
          sourceIds: [],
          earned: false,
          dueCount: 0,
          readiness: emptyReadiness(
            source.provider === 'AWS' && source.certification === 'CLF-C02',
          ),
        }
        tracks.set(key, track)
      }
      track.sourceIds.push(source.id)
    }
    for (const earned of this.repository.certificationStore().all()) {
      const key = JSON.stringify([earned.provider, earned.code])
      const track = tracks.get(key)
      if (track) {
        track.earned = true
      } else {
        tracks.set(key, {
          ...earned,
          earned: true,
          sourceIds: [],
          dueCount: 0,
          readiness: emptyReadiness(earned.provider === 'AWS' && earned.code === 'CLF-C02'),
        })
      }
    }
    const histories = new Map<string, StoredQuiz[]>()
    for (const quiz of completed) {
      const scope = certificationScope(quiz.options)
      const key = JSON.stringify([scope.provider, scope.certification])
      const history = histories.get(key) ?? []
      history.push(quiz)
      histories.set(key, history)
      if (!tracks.has(key)) {
        tracks.set(key, {
          provider: scope.provider,
          code: scope.certification,
          name: isClf(scope) ? 'Cloud Practitioner' : scope.certification,
          sourceIds: [],
          earned: false,
          dueCount: 0,
          readiness: emptyReadiness(isClf(scope)),
        })
      }
    }
    const day = studyDay(now)
    for (const [key, track] of tracks) {
      const history = histories.get(key) ?? []
      track.deletedBankAttemptCount = history.filter((quiz) => quiz.deletedBankNames?.length).length
      track.readiness = certificationReadiness(history, now, {
        provider: track.provider,
        certification: track.code,
      })
      track.dueCount = [...masteryHistory(history).states.values()].filter(
        (state) => state.dueDay !== null && state.dueDay <= day,
      ).length
    }
    const providers = new Map<string, CertificationProgress[]>()
    for (const track of tracks.values()) {
      const list = providers.get(track.provider) ?? []
      list.push(track)
      providers.set(track.provider, list)
    }
    return {
      generatedAt: now,
      providers: [...providers]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, certifications]) => ({
          name,
          certifications: certifications.sort((a, b) => a.code.localeCompare(b.code)),
          total: certifications.length,
          ready: certifications.filter((track) => track.readiness.status === 'green').length,
          dueCount: certifications.reduce((sum, track) => sum + track.dueCount, 0),
        })),
    }
  }

  /**
   * Record a user-reported credential separately from readiness and import revisions.
   * @throws {ApplicationError} When scope/earned is invalid or the certification is not tracked.
   */
  setEarned(input: unknown): HomeSummary {
    const value = input as Record<string, unknown> | null
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      typeof value.provider !== 'string' ||
      !value.provider.trim() ||
      typeof value.code !== 'string' ||
      !value.code.trim() ||
      typeof value.earned !== 'boolean'
    ) {
      throw new ApplicationError('Choose a tracked certification and a boolean earned status.')
    }
    const certification = this.get()
      .providers.flatMap((provider) => provider.certifications)
      .find((track) => track.provider === value.provider && track.code === value.code)
    if (!certification) {
      throw new ApplicationError('This certification is not tracked in your workspace.', 404)
    }
    this.repository.certificationStore().setEarned(certification, value.earned)
    return this.get()
  }
}
