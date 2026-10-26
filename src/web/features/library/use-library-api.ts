import { useCallback } from 'react'
import type { LibraryVisibility } from '../../../shared/contracts.ts'
import type { Api } from '../../shared/lib/api.ts'
import { useApi } from '../../shared/lib/workspace-api.ts'

/** Async library actions retain both their account client and their original import destination. */
export function useLibraryApi(visibility: LibraryVisibility): Api {
  const workspaceApi = useApi()
  return useCallback(
    <T>(path: string, options?: RequestInit) => workspaceApi<T>(`/${visibility}${path}`, options),
    [visibility, workspaceApi],
  )
}
