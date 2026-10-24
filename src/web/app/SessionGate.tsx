import { useEffect, useRef, useState } from 'react'
import type { Session } from '../../shared/auth-contracts.ts'
import { App } from './App.tsx'
import { useAppearance } from './use-appearance.ts'
import { StudyIcon } from '../shared/ui/StudyIcon.tsx'
import './sign-in.css'
import { createWorkspaceApi } from '../shared/lib/api.ts'
import type { WorkspaceApi } from '../shared/lib/api.ts'
import { WorkspaceApiContext } from '../shared/lib/workspace-api.ts'

type Workspace = { user: NonNullable<Session['user']>; client: WorkspaceApi; generation: number }

/** Mount a fresh workspace only after the server confirms the browser's account. */
export function SessionGate() {
  useAppearance()
  const [workspace, setWorkspace] = useState<Workspace | null | undefined>(undefined)
  const current = useRef<Workspace | null>(null)
  const workspaceGeneration = useRef(0)
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
          if (!next.user) {
            current.current?.client.invalidate()
            current.current = null
            setWorkspace(null)
          } else if (current.current?.user.id === next.user.id) {
            current.current = { ...current.current, user: next.user }
            setWorkspace(current.current)
          } else {
            current.current?.client.invalidate()
            const client = createWorkspaceApi(next.user.id, () => {
              if (active && current.current?.client === client) {
                generation++
                current.current = null
                setWorkspace(null)
              }
            })
            current.current = { user: next.user, client, generation: ++workspaceGeneration.current }
            setWorkspace(current.current)
          }
          setError('')
        }
      } catch (reason) {
        if (active && request === generation) {
          current.current?.client.invalidate()
          current.current = null
          setWorkspace(undefined)
          setError(
            reason instanceof Error ? reason.message : 'Could not check your sign-in status.',
          )
        }
      }
    }

    void refresh()
    window.addEventListener('focus', refresh)
    return () => {
      active = false
      current.current?.client.invalidate()
      current.current = null
      window.removeEventListener('focus', refresh)
    }
  }, [])

  if (workspace) {
    return (
      <WorkspaceApiContext value={workspace.client} key={workspace.generation}>
        <App account={workspace.user} />
      </WorkspaceApiContext>
    )
  }
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
        {workspace === null ? (
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
