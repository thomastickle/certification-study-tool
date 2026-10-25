import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { parseArgs } from 'node:util'
import { waitForApplication } from './support/application-readiness.ts'
import { BrowserCookies } from './support/browser-cookies.ts'

const { values } = parseArgs({
  options: {
    project: { type: 'string' },
    'app-url': { type: 'string' },
    issuer: { type: 'string' },
  },
})
const project = values.project
if (!project?.startsWith('study-auth-') || !values['app-url'] || !values.issuer) {
  throw new Error('Use an explicit disposable study-auth-* project, --app-url, and --issuer.')
}
const app = new URL(values['app-url'])
const issuer = new URL(values.issuer)
assert.equal(app.hostname, '127.0.0.1')
assert.equal(issuer.hostname, '127.0.0.1')
assert.ok(
  !['3000', '3100'].includes(app.port),
  'Use isolated test ports, not the running user preview.',
)

/** Run only the explicitly named disposable Compose project; never use the user's default stack. */
function compose(...args: string[]): string {
  return execFileSync('docker', ['compose', '-p', project!, ...args], {
    encoding: 'utf8',
    timeout: 240_000,
    maxBuffer: 2 * 1024 * 1024,
  })
}

function run(...args: string[]): string {
  return compose('run', '--rm', '--no-deps', '-T', 'study', ...args)
}

const config = JSON.parse(compose('config', '--format', 'json'))
assert.equal(config.services.study.environment.STUDY_ORIGIN, app.origin)
assert.equal(config.services.study.environment.STUDY_OIDC_ISSUER, issuer.href)
assert.equal(config.services.study.network_mode, 'service:keycloak')

/** Cookie handling is test-only HTML automation; production OAuth remains in openid-client. */
class Browser {
  private cookies = new BrowserCookies()

  async request(url: URL | string, options: RequestInit = {}): Promise<Response> {
    const target = new URL(url)
    assert.ok(
      [app.origin, issuer.origin].includes(target.origin),
      'Unexpected redirect outside the test stack.',
    )
    const headers = new Headers(options.headers)
    headers.set('Cookie', this.cookies.header(target.pathname))
    const response = await fetch(target, { ...options, headers, redirect: 'manual' })
    this.cookies.accept(response)
    return response
  }

  async follow(url: URL | string): Promise<Response> {
    let current = new URL(url)
    for (let hop = 0; hop < 12; hop++) {
      const response = await this.request(current)
      if (![301, 302, 303].includes(response.status)) {
        return response
      }
      current = new URL(response.headers.get('location')!, current)
    }
    throw new Error('Unexpected redirect loop in local login.')
  }
}

function attribute(html: string, pattern: RegExp): string {
  const value = html.match(pattern)?.[1]
  assert.ok(value, 'Expected Keycloak form/link was missing.')
  return value.replaceAll('&amp;', '&')
}

type Credentials = { username: string; password: string }

type AuthenticatedUser = { browser: Browser; id: string }

type AuthenticationScreen = { url: URL; html: string }

type RolloutUsers = {
  owner: AuthenticatedUser
  other: AuthenticatedUser
  ownerCredentials: Credentials
}

/** Start the application's real PKCE flow and fetch the provider's login screen. */
async function openLogin(browser: Browser): Promise<AuthenticationScreen> {
  const start = await browser.request(new URL('/auth/login', app))
  assert.equal(start.status, 302, 'Application did not start login.')
  const url = new URL(start.headers.get('location')!)
  const login = await browser.follow(url)
  assert.equal(login.status, 200, 'Keycloak login screen was not available.')
  const html = await login.text()
  return { url, html }
}

/** Use the same browser and cookie jar if the scenario needs a new Keycloak account. */
async function openRegistrationIfRequested(
  browser: Browser,
  screen: AuthenticationScreen,
  register: boolean,
): Promise<AuthenticationScreen> {
  if (!register) {
    return screen
  }
  const path = attribute(screen.html, /href="([^"]*login-actions\/registration[^"]*)"/)
  const url = new URL(path, issuer)
  const response = await browser.follow(url)
  assert.equal(response.status, 200, 'Keycloak registration screen was not available.')
  const html = await response.text()
  return { url, html }
}

/** Submit only the pinned provider's form; the application still performs the code/PKCE exchange. */
async function submitCredentials(
  browser: Browser,
  screen: AuthenticationScreen,
  credentials: Credentials,
  register: boolean,
): Promise<URL> {
  const form = screen.html.match(/<form\b[^>]*id="kc-(?:register|form-login)[^"]*"[^>]*>/)?.[0]
  assert.ok(form, 'Expected the Keycloak account form.')
  const action = new URL(attribute(form, /action="([^"]+)"/), screen.url)
  const { username, password } = credentials
  const fields = new URLSearchParams({ username, password })
  if (register) {
    fields.set('password-confirm', password)
    fields.set('email', username + '@example.test')
    fields.set('firstName', 'Rollout')
    fields.set('lastName', 'Test')
  }
  const submitted = await browser.request(action, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: issuer.origin },
    body: fields,
  })
  assert.ok(
    [302, 303].includes(submitted.status),
    'Keycloak did not accept the synthetic account form.',
  )
  return new URL(submitted.headers.get('location')!, action)
}

/** Follow the real callback and verify the application's own authenticated session. */
async function completeAppSession(browser: Browser, callback: URL): Promise<AuthenticatedUser> {
  const landing = await browser.follow(callback)
  assert.equal(landing.status, 200, 'Application callback did not return its public page.')
  const response = await browser.request(new URL('/api/session', app))
  const session = await response.json()
  assert.ok(session.user?.id, 'The real OIDC callback did not establish a user session.')
  return { browser, id: session.user.id }
}

/** Keep one browser through every phase of registration or returning-user authentication. */
async function authenticate(
  credentials: Credentials,
  register: boolean,
): Promise<AuthenticatedUser> {
  const browser = new Browser()
  const login = await openLogin(browser)
  const screen = await openRegistrationIfRequested(browser, login, register)
  const callback = await submitCredentials(browser, screen, credentials, register)
  return completeAppSession(browser, callback)
}

async function api<T>(client: AuthenticatedUser, path: string): Promise<T> {
  const response = await client.browser.request(new URL('/api' + path, app), {
    headers: { 'X-Study-Account': client.id },
  })
  assert.equal(response.status, 200)
  return response.json()
}

// This script runs inside the image, where only application modules are available.
const legacySeedScript = `
import { existsSync } from 'node:fs'
import { LibraryRepository } from './src/server/questions/library-repository.ts'
import { ImportService } from './src/server/importer/import-service.ts'
import { QuizService } from './src/server/quizzes/quiz-service.ts'

if (existsSync('/data/library.sqlite3')) {
  throw new Error('Use a fresh disposable volume for the rollout smoke test.')
}
const repo = new LibraryRepository('/data/library.sqlite3')
const certification = { provider: 'Example', code: 'DEMO-1', name: 'Legacy rollout fixture' }
const questions = Array.from({ length: 20 }, (_, index) => ({
  source_ref: String(index),
  question: 'Synthetic legacy question ' + index + '?',
  type: 'single_select',
  select_count: 1,
  answers: [
    { text: 'Correct example', correct: true },
    { text: 'Other example', correct: false },
  ],
}))
const bank = {
  schema_version: 2,
  certification,
  source: {
    key: 'legacy-rollout',
    name: 'Synthetic legacy rollout',
    type: 'third_party',
    verification_status: 'unverified',
  },
  questions,
}
const importer = new ImportService(repo)
const preview = importer.preview(bank)
importer.confirm(bank, preview.token, false)

const service = new QuizService(repo)
const options = {
  provider: 'Example',
  certification: 'DEMO-1',
  sourceFilter: 'mixed',
  questionType: 'mixed',
}
const quiz = service.start(options)
const submission = {
  answers: quiz.questions.map(question => ({
    questionId: question.questionId,
    selected: [],
    confidence: 'Unsure',
    flagged: false,
  })),
}
service.submit(quiz.id, submission)
repo.certificationStore().setEarned(certification, true)
repo.close()
`

/** Hash the legacy database in place without copying private contents into the host checkout. */
function sourceHash(): string {
  const script = `
    import { readFileSync } from 'node:fs'
    import { createHash } from 'node:crypto'

    const contents = readFileSync('/data/library.sqlite3')
    console.log(createHash('sha256').update(contents).digest('hex'))
  `
  return run('node', '--input-type=module', '-e', script).trim()
}

const migration = (accountId: string, apply = false) =>
  JSON.parse(
    run(
      'node',
      'src/server/auth/migrate-library-cli.ts',
      '--data-dir',
      '/data',
      '--account-id',
      accountId,
      ...(apply ? ['--apply'] : []),
    ),
  )

/** Seed only the explicitly named disposable volume, retaining its hash for all later checks. */
function seedLegacyLibrary(): string {
  compose('stop', 'study')
  run('node', '--input-type=module', '-e', legacySeedScript)
  return sourceHash()
}

/** Wait for live HTTP readiness after both ordinary starts and full service recreation. */
async function startApplication({ recreate = false }: { recreate?: boolean } = {}): Promise<void> {
  compose(
    'up',
    '--no-build',
    ...(recreate ? ['--force-recreate'] : []),
    '-d',
    '--wait',
    '--wait-timeout',
    '180',
  )
  await waitForApplication(app)
}

/** Register separate identities and prove both begin with private empty libraries. */
async function registerIsolatedUsers(): Promise<RolloutUsers> {
  await startApplication()
  const ownerCredentials = {
    username: 'rollout-owner-' + randomUUID().slice(0, 8),
    password: randomUUID() + '!aA1',
  }
  const owner = await authenticate(ownerCredentials, true)
  const otherCredentials = {
    username: 'rollout-other-' + randomUUID().slice(0, 8),
    password: randomUUID() + '!aA1',
  }
  const other = await authenticate(otherCredentials, true)
  const ownerLibrary = await api<{ total: number }>(owner, '/questions')
  assert.equal(ownerLibrary.total, 0)
  const otherLibrary = await api<{ total: number }>(other, '/questions')
  assert.equal(otherLibrary.total, 0)
  return { owner, other, ownerCredentials }
}

/** Refuse online migration, then preview and apply offline without changing the legacy source. */
async function migrateToOwner(owner: AuthenticatedUser, originalHash: string): Promise<void> {
  assert.throws(() => migration(owner.id, true), /in use/)
  compose('stop', 'study')
  assert.equal(migration(owner.id).applied, false)
  const result = migration(owner.id, true)
  assert.equal(result.applied, true)
  assert.ok(result.backup)
  assert.equal(sourceHash(), originalHash)
  await startApplication()
}

/** Check ownership and complete history independently of the way the services were started. */
async function verifyMigratedWorkspaces(
  owner: AuthenticatedUser,
  other: AuthenticatedUser,
): Promise<void> {
  const ownerLibrary = await api<{ total: number }>(owner, '/questions')
  assert.equal(ownerLibrary.total, 20)
  const ownerHistory = await api<unknown[]>(owner, '/quizzes?provider=Example&certification=DEMO-1')
  assert.equal(ownerHistory.length, 1)
  const otherLibrary = await api<{ total: number }>(other, '/questions')
  assert.equal(otherLibrary.total, 0)
}

/** Recreate both containers and prove provider identity, study data, and local sessions survive. */
async function verifyAfterRecreation(users: RolloutUsers, originalHash: string): Promise<void> {
  await startApplication({ recreate: true })
  const signedInAgain = await authenticate(users.ownerCredentials, false)
  assert.equal(signedInAgain.id, users.owner.id)
  await verifyMigratedWorkspaces(signedInAgain, users.other)
  assert.equal(sourceHash(), originalHash)
}

// The caller/CI owns final cleanup of this explicitly named disposable Compose project.
try {
  const originalHash = seedLegacyLibrary()
  const users = await registerIsolatedUsers()
  await migrateToOwner(users.owner, originalHash)
  await verifyMigratedWorkspaces(users.owner, users.other)
  await verifyAfterRecreation(users, originalHash)
  const summary = {
    login: 'passed',
    migratedQuestions: 20,
    completedHistory: 1,
    otherUserQuestions: 0,
    usersAndDataSurviveRecreation: true,
    legacySourceUnchanged: true,
  }
  console.log(JSON.stringify(summary))
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Rollout smoke test failed.')
  process.exitCode = 1
}
