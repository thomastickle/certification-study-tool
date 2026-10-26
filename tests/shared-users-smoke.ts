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
import { legacyAccountSchema, legacyStudySchema } from './legacy-study-schema.ts'
import type { Session } from '../src/shared/auth-contracts.ts'

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
assert.ok(app.port && issuer.port, 'Both URLs must specify explicit isolated ports.')
assert.notEqual(app.port, issuer.port, 'Application and provider ports must differ.')
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
const directory = mkdtempSync(join(tmpdir(), 'study-shared-smoke-'))
const owner = { id: randomUUID(), username: 'synthetic-owner', password: randomUUID() + '!aA1' }
const other = { id: randomUUID(), username: 'synthetic-other', password: randomUUID() + '!aA1' }
const previousOwnerAccount = randomUUID()
const administrator = {
  id: randomUUID(),
  username: 'synthetic-second-admin',
  password: randomUUID() + '!aA1',
}
const realm = JSON.parse(readFileSync('dev/keycloak/study-realm.json', 'utf8'))
realm.users = [owner, other, administrator].map((user) => ({
  id: user.id,
  username: user.username,
  enabled: true,
  firstName: 'Synthetic',
  lastName: 'User',
  email: user.username + '@example.test',
  credentials: [{ type: 'password', value: user.password, temporary: false }],
  clientRoles: { 'study-tool': user.id === other.id ? [] : ['admin'] },
}))
writeFileSync(join(directory, 'study-realm.json'), JSON.stringify(realm), { mode: 0o600 })
// Match the host file owner while retaining group 0 access to the image's writable directories.
// CI runners and local desktops need not use the same UID; fixture files stay private.
const overridePath = join(directory, 'compose-smoke.yaml')
const keycloakUser = `${process.getuid?.() ?? 1000}:0`
const override = { services: { keycloak: { user: keycloakUser } } }
writeFileSync(overridePath, JSON.stringify(override), { mode: 0o600 })
const environment = {
  ...process.env,
  STUDY_WEB_PORT: app.port,
  STUDY_KEYCLOAK_PORT: issuer.port,
  STUDY_ORIGIN: app.origin,
  STUDY_OIDC_ISSUER: issuer.href,
  STUDY_LEGACY_OWNER_SUBJECT: owner.id,
  STUDY_KEYCLOAK_IMPORT_DIR: directory,
  KC_BOOTSTRAP_ADMIN_PASSWORD: randomUUID(),
}

/** Preserve the same environment and explicit project through setup, recreation and cleanup. */
function compose(...args: string[]): string {
  return docker(
    ['compose', '-f', 'compose.yaml', '-f', overridePath, '-p', project!, ...args],
    environment,
  )
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

/** Seed the deployed single-owner schema so startup must map history to the explicit owner. */
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
    import { DatabaseSync } from 'node:sqlite'
    const repo = new LibraryRepository('/data/library.sqlite3')
    const input = ${JSON.stringify(input)}
    const importer = new ImportService(repo)
    const preview = importer.preview(input)
    importer.confirm(input, preview.token, false)
    const service = new QuizService(repo)
    const options = {
      provider: 'Example',
      certification: 'DEMO-1',
      sourceFilter: 'mixed',
      questionType: 'mixed',
    }
    const quiz = service.start(options)
    const answers = quiz.questions.map(question => ({
      questionId: question.questionId,
      selected: [],
      confidence: 'Unsure',
      flagged: false,
    }))
    service.submit(quiz.id, { answers })
    repo.certificationStore().setEarned({ provider: 'Example', code: 'DEMO-1', name: 'Example' }, true)
    repo.close()
    const legacy = new DatabaseSync('/data/library.sqlite3')
    legacy.exec(${JSON.stringify(legacyStudySchema)})
    legacy.close()
    const accounts = new DatabaseSync('/data/accounts.sqlite3')
    accounts.exec(${JSON.stringify(legacyAccountSchema)})
    const identity = accounts.prepare('INSERT INTO accounts VALUES (?, ?, ?, ?)')
    identity.run(${JSON.stringify(previousOwnerAccount)}, ${JSON.stringify(issuer.href)}, ${JSON.stringify(owner.id)}, 'Legacy owner')
    accounts.close()
  `
  compose('run', '--rm', '--no-deps', '-T', 'study', 'node', '--input-type=module', '-e', script)
}

/** Bind every test API operation to the account returned by that browser's own session. */
async function study(browser: Browser, path: string, options: RequestInit = {}): Promise<Response> {
  const user = await currentUser(browser)
  const headers = new Headers(options.headers)
  headers.set('X-Study-Account', user.id)
  headers.set('Origin', app.origin)
  headers.set('Content-Type', 'application/json')
  return browser.request(new URL(path, app), { ...options, headers })
}

/** Resolve one browser's verified identity and role without reusing another browser's binding. */
async function currentUser(browser: Browser) {
  const response = await browser.request(new URL('/api/session', app))
  assert.equal(response.status, 200)
  const session: Session = await response.json()
  assert.ok(session.user)
  return session.user
}

/** Keep response validation separate from JSON inspection in integration assertions. */
async function studyJson(browser: Browser, path: string, options: RequestInit = {}) {
  const response = await study(browser, path, options)
  assert.equal(response.status, 200)
  return response.json()
}

/** Inspect one user's own completed history without relying on another account's identifiers. */
async function history(browser: Browser) {
  const response = await study(browser, '/api/quizzes?provider=Example&certification=DEMO-1')
  assert.equal(response.status, 200)
  return response.json() as Promise<Array<{ id: string }>>
}

try {
  compose('up', '--no-build', '-d', '--wait', '--wait-timeout', '180', 'keycloak')
  seedLibrary()
  compose('up', '--no-build', '-d', '--wait', '--wait-timeout', '180')
  await waitForApplication(app)
  assert.equal((await fetch(new URL('/api/questions', app))).status, 401)

  const signedIn = await login(owner)
  const student = await login(other)
  const secondAdmin = await login(administrator)
  assert.equal(signedIn.status, 200)
  assert.equal(student.status, 200)
  assert.equal(secondAdmin.status, 200)
  const ownerSession = await currentUser(signedIn.browser)
  const studentSession = await currentUser(student.browser)
  assert.equal(ownerSession.role, 'admin')
  assert.equal(ownerSession.id, previousOwnerAccount)
  assert.equal(studentSession.role, 'student')
  assert.notEqual(ownerSession.id, studentSession.id)
  const questions = await studyJson(student.browser, '/api/questions')
  assert.equal(questions.total, 20)
  const originalHistory = await history(signedIn.browser)
  assert.equal(originalHistory.length, 1)
  assert.deepEqual(await history(student.browser), [])
  const ownerHome = await studyJson(signedIn.browser, '/api/home')
  const studentHome = await studyJson(student.browser, '/api/home')
  assert.equal(ownerHome.providers[0].certifications[0].earned, true)
  assert.equal(studentHome.providers[0].certifications[0].earned, false)

  const deleteDenied = await study(student.browser, '/api/questions/' + questions.items[0].id, {
    method: 'DELETE',
  })
  assert.equal(deleteDenied.status, 403)
  const started = await study(student.browser, '/api/quizzes', {
    method: 'POST',
    body: JSON.stringify({
      provider: 'Example',
      certification: 'DEMO-1',
      sourceFilter: 'mixed',
      questionType: 'mixed',
    }),
  })
  assert.equal(started.status, 201)
  const quiz = await started.json()
  assert.equal((await study(signedIn.browser, '/api/quizzes/' + quiz.id)).status, 404)
  const answers = quiz.questions.map((question: { questionId: number }) => ({
    questionId: question.questionId,
    selected: [],
    confidence: 'Unsure',
    flagged: false,
  }))
  assert.equal(
    (
      await study(student.browser, '/api/quizzes/' + quiz.id + '/submit', {
        method: 'POST',
        body: JSON.stringify({ answers }),
      })
    ).status,
    200,
  )
  assert.deepEqual(await history(signedIn.browser), originalHistory)
  assert.deepEqual(
    (await history(student.browser)).map((item) => item.id),
    [quiz.id],
  )

  const input = bank('new-shared-bank')
  const previewRequest = { method: 'POST', body: JSON.stringify({ bank: input }) }
  assert.equal((await study(student.browser, '/api/imports/preview', previewRequest)).status, 403)
  const preview = await studyJson(signedIn.browser, '/api/imports/preview', previewRequest)
  const confirmation = {
    method: 'POST',
    body: JSON.stringify({ bank: input, token: preview.token, reviewed: true }),
  }
  assert.equal((await study(secondAdmin.browser, '/api/imports/confirm', confirmation)).status, 409)
  assert.equal((await study(signedIn.browser, '/api/imports/confirm', confirmation)).status, 201)
  assert.equal((await study(signedIn.browser, '/api/imports/confirm', confirmation)).status, 409)
  const updatedQuestions = await studyJson(student.browser, '/api/questions')
  assert.equal(updatedQuestions.total, 21)
  const stale = await student.browser.request(
    new URL('/api/questions/' + questions.items[0].id, app),
    {
      method: 'DELETE',
      headers: { Origin: app.origin, 'X-Study-Account': ownerSession.id },
    },
  )
  assert.equal(stale.status, 409)

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
  assert.deepEqual(await history(signedIn.browser), originalHistory)
  assert.deepEqual(
    (await history(student.browser)).map((item) => item.id),
    [quiz.id],
  )
  const restartedQuestions = await studyJson(student.browser, '/api/questions')
  const restartedOwner = await currentUser(signedIn.browser)
  const restartedStudent = await currentUser(student.browser)
  assert.equal(restartedQuestions.total, 21)
  assert.equal(restartedOwner.role, 'admin')
  assert.equal(restartedStudent.role, 'student')
  console.log(
    JSON.stringify({
      adminAndStudentLogin: true,
      legacyOwnerHistory: 1,
      privateStudentHistory: 1,
      sharedQuestions: 21,
      studentMutationDenied: true,
      crossAccountPreviewDenied: true,
      staleWorkspaceDenied: true,
      sessionsSurviveRecreation: true,
    }),
  )
} finally {
  try {
    compose('down', '--volumes', '--remove-orphans')
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}
