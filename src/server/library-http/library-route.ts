/** Strip only the three explicitly supported content namespaces. */
export function route(path: string) {
  return path.replace(/^\/api\/(?:shared\/|private\/)?/, '')
}
