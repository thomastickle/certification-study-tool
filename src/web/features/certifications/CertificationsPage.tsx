import { useEffect, useRef, useState } from 'react'
import type { CertificationProgress, HomeSummary } from '../../../shared/home-contracts.ts'
import { api } from '../../shared/lib/api.ts'

/** Manage earned status independently from study readiness. */
export function CertificationsPage() {
  const [summary, setSummary] = useState<HomeSummary>()
  const [error, setError] = useState('')
  const [pending, setPending] = useState<string>()
  const updating = useRef(false)
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
          setError(reason instanceof Error ? reason.message : 'Could not load certifications.')
        }
      })
    return () => {
      active = false
    }
  }, [attempt])

  /** Serialize settings writes so an older aggregate response cannot overwrite a newer choice. */
  async function updateEarned(certification: CertificationProgress, earned: boolean) {
    if (updating.current) {
      return
    }
    updating.current = true
    const key = `${certification.provider}:${certification.code}`
    setPending(key)
    setError('')
    try {
      const result = await api<HomeSummary>('/certifications/earned', {
        method: 'PUT',
        body: JSON.stringify({
          provider: certification.provider,
          code: certification.code,
          earned,
        }),
      })
      setSummary(result)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not update earned status.')
    } finally {
      updating.current = false
      setPending(undefined)
    }
  }

  if (error && !summary) {
    return (
      <main className="home-page certifications-page">
        <section className="home-empty" role="alert">
          <h1>Certifications could not load</h1>
          <p>{error}</p>
          <button onClick={() => setAttempt((value) => value + 1)}>Retry</button>
        </section>
      </main>
    )
  }
  if (!summary) {
    return (
      <main className="home-page certifications-page" aria-busy="true">
        <p>Loading certifications…</p>
      </main>
    )
  }

  const certifications = summary.providers.flatMap((provider) => provider.certifications)
  return (
    <main className="home-page certifications-page">
      <div className="page-heading">
        <div>
          <h1>All certifications</h1>
          <p className="intro">Track certifications you have earned.</p>
        </div>
      </div>
      {error && (
        <p className="certification-error" role="alert">
          {error}
        </p>
      )}
      {certifications.length === 0 ? (
        <section className="home-empty">
          <h2>No certifications to manage</h2>
          <p>Import question banks to add certification tracks.</p>
        </section>
      ) : (
        summary.providers.map((provider, index) => (
          <section
            className="management-card"
            key={provider.name}
            aria-labelledby={`certification-provider-${index}`}
          >
            <h2 id={`certification-provider-${index}`}>{provider.name}</h2>
            {provider.certifications.map((certification) => {
              return (
                <label className="earned-control" key={certification.code}>
                  <span>
                    <strong>{certification.name}</strong>
                    <code>{certification.code}</code>
                  </span>
                  <input
                    type="checkbox"
                    checked={certification.earned}
                    disabled={pending !== undefined}
                    aria-label={`Earned ${certification.name} (${certification.code})`}
                    onChange={(event) => {
                      void updateEarned(certification, event.currentTarget.checked)
                    }}
                  />
                </label>
              )
            })}
          </section>
        ))
      )}
    </main>
  )
}
