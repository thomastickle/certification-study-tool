import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { bank } from './fixtures.ts'
import { BrowserCookies } from './support/browser-cookies.ts'
import { waitForApplication } from './support/application-readiness.ts'

const { values } = parseArgs({
  options: {
    project: { type: 'string' },
    'app-url': { type: 'string' },
    issuer: { type: 'string' },
  },
})
assert.ok(values.project?.startsWith('study-login-'), 'Use a disposable study-login-* project.')
assert.ok(values['app-url'] && values.issuer, 'Supply explicit local application and issuer URLs.')
const project = values.project
const app = new URL(values['app-url'])
const issuer = new URL(values.issuer)
assert.equal(app.hostname, '127.0.0.1')
assert.equal(issuer.hostname, '127.0.0.1')
assert.ok(!['3000', '3100', '3200'].includes(app.port), 'Use an isolated integration-test port.')

/** Run only the disposable test stack; capture failures without exposing credential-bearing inputs. */
function docker(args: string[], env = process.env): string {
  try {
    return execFileSync('docker', args, { env, encoding: 'utf8', timeout: 240_000, stdio: 'pipe' })
  } catch {
    throw new Error('A disposable Docker integration command failed.')
  }
}

const selector = `label=com.docker.compose.project=${project}`
assert.equal(
  docker(['ps', '-aq', '--filter', selector]).trim(),
  '',
  'Test containers already exist.',
)
assert.equal(
  docker(['volume', 'ls', '-q', '--filter', selector]).trim(),
  '',
  'Test volumes already exist.',
)
const directory = mkdtempSync(join(tmpdir(), 'study-owner-smoke-'))
const owner = { id: randomUUID(), username: 'synthetic-owner', password: randomUUID() + '!aA1' }
const other = { id: randomUUID(), username: 'synthetic-other', password: randomUUID() + '!aA1' }
const realm = JSON.parse(readFileSync('dev/keycloak/study-realm.json', 'utf8'))
realm.users = [owner, other].map((user) => ({
  id: user.id,
  username: user.username,
  enabled: true,
  firstName: 'Synthetic',
  lastName: 'User',
  email: user.username + '@example.test',
  credentials: [{ type: 'password', value: user.password, temporary: false }],
}))
writeFileSync(join(directory, 'study-realm.json'), JSON.stringify(realm), { mode: 0o600 })
const environment = {
  ...process.env,
  STUDY_WEB_PORT: app.port,
  STUDY_KEYCLOAK_PORT: issuer.port,
  STUDY_ORIGIN: app.origin,
  STUDY_OIDC_ISSUER: issuer.href,
  STUDY_OWNER_SUBJECT: owner.id,
  STUDY_KEYCLOAK_IMPORT_DIR: directory,
  KC_BOOTSTRAP_ADMIN_PASSWORD: randomUUID(),
}

/** Preserve the same environment and explicit project through setup, recreation and cleanup. */
function compose(...args: string[]): string {
  return docker(['compose', '-p', project!, ...args], environment)
}

/** A test-only browser follows forms; application OAuth remains entirely in openid-client. */
class Browser {
  private cookies = new BrowserCookies()

  async request(url: URL | string, options: RequestInit = {}): Promise<Response> {
    const target = new URL(url)
    assert.ok([app.origin, issuer.origin].includes(target.origin), 'Unexpected provider redirect.')
    const headers = new Headers(options.headers)
    headers.set('Cookie', this.cookies.header(target.pathname))
    const response = await fetch(target, { ...options, headers, redirect: 'manual' })
    this.cookies.accept(response)
    return response
  }

  async follow(url: URL): Promise<Response> {
    let current = url
    for (let hop = 0; hop < 12; hop++) {
      const response = await this.request(current)
      if (![301, 302, 303].includes(response.status)) {
        return response
      }
      current = new URL(response.headers.get('location')!, current)
    }
    throw new Error('Unexpected authentication redirect loop.')
  }
}

/** Submit synthetic credentials only to the pinned local provider's own form. */
async function login(credentials: typeof owner): Promise<{ browser: Browser; status: number }> {
  const browser = new Browser()
  const start = await browser.request(new URL('/auth/login', app))
  assert.equal(start.status, 302)
  const screen = await browser.follow(new URL(start.headers.get('location')!))
  const html = await screen.text()
  const action = html.match(/<form\b[^>]*action="([^"]+)"[^>]*>/)?.[1]
  assert.ok(action, 'Keycloak login form missing.')
  const target = new URL(action.replaceAll('&amp;', '&'), issuer)
  const fields = new URLSearchParams({
    username: credentials.username,
    password: credentials.password,
  })
  const submitted = await browser.request(target, {
    method: 'POST',
    headers: { Origin: issuer.origin, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: fields,
  })
  assert.ok([302, 303].includes(submitted.status), 'Synthetic provider login failed.')
  const landing = await browser.follow(new URL(submitted.headers.get('location')!, target))
  return { browser, status: landing.status }
}

/** Seed existing single-library data before the application starts; no migration is involved. */
function seedLibrary(): void {
  const input = bank()
  input.questions = Array.from({ length: 20 }, (_, index) => ({
    ...structuredClone(input.questions[0]!),
    source_ref: String(index),
    question: `Synthetic seed ${index}?`,
  }))
  const script = `
    import { LibraryRepository } from './src/server/questions/library-repository.ts'
    import { ImportService } from './src/server/importer/import-service.ts'
    import { QuizService } from './src/server/quizzes/quiz-service.ts'
    const repo = new LibraryRepository('/data/library.sqlite3')
    const input = ${JSON.stringify(input)}
    const importer = new ImportService(repo)
    const preview = importer.preview(input)
    importer.confirm(input, preview.token, false)
    const service = new QuizService(repo)
    const quiz = service.start({provider:'Example',certification:'DEMO-1',sourceFilter:'mixed',questionType:'mixed'})
    const answers = quiz.questions.map(q => ({questionId:q.questionId,selected:[],confidence:'Unsure',flagged:false}))
    service.submit(quiz.id, {answers})
    repo.close()
  `
  compose('run', '--rm', '--no-deps', '-T', 'study', 'node', '--input-type=module', '-e', script)
}

try {
  compose('up', '--no-build', '-d', '--wait', '--wait-timeout', '180', 'keycloak')
  seedLibrary()
  compose('up', '--no-build', '-d', '--wait', '--wait-timeout', '180')
  await waitForApplication(app)
  assert.equal((await fetch(new URL('/api/questions', app))).status, 401)
  const signedIn = await login(owner)
  assert.equal(signedIn.status, 200)
  const session = await signedIn.browser.request(new URL('/api/session', app))
  const account = (await session.json()).user
  assert.ok(account?.id)
  const headers = { 'X-Study-Account': account.id }
  const questions = await signedIn.browser.request(new URL('/api/questions', app), { headers })
  assert.equal((await questions.json()).total, 20)
  const denied = await login(other)
  assert.equal(denied.status, 403)
  compose(
    'up',
    '--no-build',
    '--no-deps',
    '--force-recreate',
    '-d',
    '--wait',
    '--wait-timeout',
    '90',
    'study',
  )
  await waitForApplication(app)
  const history = await signedIn.browser.request(
    new URL('/api/quizzes?provider=Example&certification=DEMO-1', app),
    { headers },
  )
  assert.equal(history.status, 200)
  assert.equal((await history.json()).length, 1)
  const summary = {
    ownerLogin: true,
    nonOwnerDenied: true,
    existingQuestions: 20,
    existingHistory: 1,
    sessionSurvivesRecreation: true,
  }
  console.log(JSON.stringify(summary))
} finally {
  try {
    compose('down', '--volumes', '--remove-orphans')
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}
