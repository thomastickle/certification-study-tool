import { ApplicationRuntime } from '../../src/server/application-runtime.ts'
import { LibraryHttpModule } from '../../src/server/library-http/library-http.module.ts'
import { StudyHttpModule } from '../../src/server/study-http/study.module.ts'
import { fixture as libraryFixture } from './study-http-fixture.ts'

/** Keep direct seeding in the same real account scope used by authenticated Nest requests. */
export async function compatibilityFixture(role: 'admin' | 'student' = 'admin') {
  const fixture = await libraryFixture(undefined, [LibraryHttpModule, StudyHttpModule])
  if (role === 'student') {
    fixture.administrators.delete('alice')
  }
  fixture.config.origin.port = String(fixture.port)
  fixture.config.origin.hostname = '127.0.0.1'
  const cookie = await fixture.login('alice')
  const id = fixture.sessions.get(cookie)!
  const runtime = fixture.app.get(ApplicationRuntime)
  let personal = runtime.privateLibraries.open(id)
  const repository = runtime.sharedLibrary.forAccount(id, personal)
  const base = `http://127.0.0.1:${fixture.port}`

  const authenticatedFetch = (input: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers)
    if (!headers.has('Origin')) {
      headers.set('Origin', base)
    }
    headers.set('Cookie', cookie)
    headers.set('X-Study-Account', id)
    return fetch(input, { ...init, headers })
  }

  return {
    repository,
    personal,
    shared: runtime.sharedLibrary,
    base,
    port: fixture.port,
    fetch: authenticatedFetch,
    restart: async () => {
      personal.close()
      await fixture.restart()
      const restarted = fixture.app.get(ApplicationRuntime)
      personal = restarted.privateLibraries.open(id)
      return restarted.sharedLibrary.forAccount(id, personal)
    },
    close: async () => {
      personal.close()
      await fixture.close()
    },
  }
}
