import { createContext, useContext } from 'react'
import type { Api, WorkspaceApi } from './api.ts'

export const WorkspaceApiContext = createContext<WorkspaceApi | null>(null)

/** Capture the immutable client provided by this mounted workspace. */
export function useWorkspaceApi(): WorkspaceApi {
  const workspace = useContext(WorkspaceApiContext)
  if (!workspace) {
    throw new Error('A signed-in workspace is required.')
  }
  return workspace
}

/** Async handlers retain their originating workspace even after another account mounts. */
export function useApi(): Api {
  return useWorkspaceApi().api
}
