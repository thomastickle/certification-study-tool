import { useEffect, useState } from 'react'
import type { CertificationProgress, HomeSummary } from '../../../shared/home-contracts.ts'
import { useApi } from '../../shared/lib/workspace-api.ts'
import { HomeDashboard, type HomeNavigation } from './HomeDashboard.tsx'

type Props = {
  onNavigate: (page: HomeNavigation) => void
  onPractice: (track: CertificationProgress) => void
  onReview: (track: CertificationProgress) => void
}

/** Load current readiness for the workspace home screen with an explicit retry path. */
export function HomePage({ onNavigate, onPractice, onReview }: Props) {
  const api = useApi()
  const [summary, setSummary] = useState<HomeSummary>()
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let active = true
    setError('')
    api<HomeSummary>('/home')
      .then((result) => {
        if (active) {
          setSummary(result)
        }
      })
      .catch((reason: unknown) => {
        if (active) {
          setError(reason instanceof Error ? reason.message : 'Could not load readiness.')
        }
      })
    return () => {
      active = false
    }
  }, [attempt])

  if (error) {
    return (
      <main className="home-page">
        <section className="home-empty" role="alert">
          <h1>Readiness could not load</h1>
          <p>{error}</p>
          <button onClick={() => setAttempt((value) => value + 1)}>Retry</button>
        </section>
      </main>
    )
  }
  if (!summary) {
    return (
      <main className="home-page" aria-busy="true">
        <p>Loading certification readiness…</p>
      </main>
    )
  }
  return (
    <HomeDashboard
      summary={summary}
      onNavigate={onNavigate}
      onPractice={onPractice}
      onReview={onReview}
    />
  )
}
