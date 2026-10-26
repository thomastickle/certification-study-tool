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

    /** An expiration belongs only to the client that reported it, not a replacement workspace. */
    function expireWorkspace(client: WorkspaceApi) {
      if (!active || current.current?.client !== client) {
        return
      }
      generation++
      current.current.client.invalidate()
      current.current = null
      setWorkspace(null)
    }

    /** Apply missing, same-user, and replacement identities while preserving client lifetimes. */
    function transitionSession(user: Session['user']) {
      const previous = current.current
      if (!user) {
        previous?.client.invalidate()
        current.current = null
      } else if (previous?.user.id === user.id) {
        current.current = { ...previous, user }
      } else {
        previous?.client.invalidate()
        const client = createWorkspaceApi(user.id, () => expireWorkspace(client))
        current.current = { user, client, generation: ++workspaceGeneration.current }
      }
      setWorkspace(current.current)
      setError('')
    }

    /** A failed current check closes the old workspace and presents retry rather than sign-in. */
    function failSessionCheck(reason: unknown) {
      current.current?.client.invalidate()
      current.current = null
      setWorkspace(undefined)
      const message = 'Could not check your sign-in status.'
      setError(reason instanceof Error ? reason.message : message)
    }

    /** Acquire the session and discard responses superseded by focus checks or expiration. */
    async function refresh() {
      const request = ++generation
      try {
        const response = await fetch('/api/session', { cache: 'no-store' })
        if (!response.ok) {
          throw new Error('Could not check your sign-in status. Please retry.')
        }
        const next: Session = await response.json()
        if (active && request === generation) {
          transitionSession(next.user)
        }
      } catch (reason) {
        if (active && request === generation) {
          failSessionCheck(reason)
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
  let sessionAction = <p role="status">Checking sign-in…</p>
  if (workspace === null) {
    sessionAction = (
      <a className="sign-in-link" href="/auth/login">
        Sign in
      </a>
    )
  } else if (error) {
    sessionAction = <button onClick={() => window.location.reload()}>Retry</button>
  }
  return (
    <main className="sign-in-page">
      <section className="sign-in-card">
        <StudyIcon name="cloud" />
        <p className="sign-in-brand">Certification Study Tool</p>
        <h1>Your next certification starts here.</h1>
        <p>Sign in to your question library, practice sessions, and progress.</p>
        {error && (
          <p className="message error" role="alert">
            {error}
          </p>
        )}
        {sessionAction}
      </section>
    </main>
  )
}
