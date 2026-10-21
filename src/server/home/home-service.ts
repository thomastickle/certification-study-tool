import type { CertificationProgress, HomeSummary } from '../../shared/home-contracts.ts'
import type { LibraryRepository } from '../questions/library-repository.ts'
import { emptyReadiness } from './readiness.ts'

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
    const providers = new Map<string, CertificationProgress[]>()
    for (const track of tracks.values()) {
      const list = providers.get(track.provider) ?? []
      list.push(track)
      providers.set(track.provider, list)
    }
    return {
      generatedAt: this.now(),
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
}
