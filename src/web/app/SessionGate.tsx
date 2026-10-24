import { useEffect, useState } from 'react'
import type { Session } from '../../shared/auth-contracts.ts'
import { App } from './App.tsx'
import { useAppearance } from './use-appearance.ts'
import { StudyIcon } from '../shared/ui/StudyIcon.tsx'
import './sign-in.css'

/** Mount a fresh workspace only after the server confirms the browser's account. */
export function SessionGate() {
  useAppearance()
  const [session, setSession] = useState<Session | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    let generation = 0

    /** Ignore obsolete responses after an expiration event or a newer session check. */
    async function refresh() {
      const request = ++generation
      try {
        const response = await fetch('/api/session', { cache: 'no-store' })
        if (!response.ok) throw new Error('Could not check your sign-in status. Please retry.')
        const next: Session = await response.json()
        if (active && request === generation) {
          setSession(next)
          setError('')
        }
      } catch (reason) {
        if (active && request === generation) {
          setSession(null)
          setError(
            reason instanceof Error ? reason.message : 'Could not check your sign-in status.',
          )
        }
      }
    }

    function expired() {
      generation++
      setSession({ user: null })
    }

    void refresh()
    window.addEventListener('focus', refresh)
    window.addEventListener('study-session-expired', expired)
    return () => {
      active = false
      window.removeEventListener('focus', refresh)
      window.removeEventListener('study-session-expired', expired)
    }
  }, [])

  if (session?.user) return <App key={session.user.id} account={session.user} />
  return (
    <main className="sign-in-page">
      <section className="sign-in-card">
        <StudyIcon name="cloud" />
        <p className="sign-in-brand">Certification Study Tool</p>
        <h1>Your next certification starts here.</h1>
        <p>Sign in to your private question library, practice sessions, and progress.</p>
        {error && (
          <p className="message error" role="alert">
            {error}
          </p>
        )}
        {session ? (
          <a className="sign-in-link" href="/auth/login">
            Sign in
          </a>
        ) : error ? (
          <button onClick={() => window.location.reload()}>Retry</button>
        ) : (
          <p role="status">Checking sign-in…</p>
        )}
      </section>
    </main>
  )
}
