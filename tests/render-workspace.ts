import { createElement } from 'react'
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createWorkspaceApi } from '../src/web/shared/lib/api.ts'
import { WorkspaceApiContext } from '../src/web/shared/lib/workspace-api.ts'

/** Render authenticated screens with their required context, without running network effects. */
export function renderWorkspace(element: ReactNode): string {
  return renderToStaticMarkup(
    createElement(WorkspaceApiContext, { value: createWorkspaceApi('synthetic-test') }, element),
  )
}
