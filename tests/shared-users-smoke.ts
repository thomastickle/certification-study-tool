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
import { prepareRuntimeDatabase, provisionTestWorkspace } from './managed-database-fixture.ts'
import { DatabaseSync } from 'node:sqlite'
import { LibraryRepository } from '../src/server/questions/library-repository.ts'
import { ImportService } from '../src/server/importer/import-service.ts'
import { QuizService } from '../src/server/quizzes/quiz-service.ts'
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
const data = join(directory, 'data')
const central = join(data, 'central.sqlite3')
const override = {
  services: {
    keycloak: { user: keycloakUser },
    study: { user: keycloakUser, volumes: [`${data}:/data`] },
  },
}
writeFileSync(overridePath, JSON.stringify(override), { mode: 0o600 })
const environment = {
  ...process.env,
  STUDY_WEB_PORT: app.port,
  STUDY_KEYCLOAK_PORT: issuer.port,
  STUDY_ORIGIN: app.origin,
  STUDY_OIDC_ISSUER: issuer.href,
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

/** Seed prepared synthetic history; legacy conversion is verified at the external admin boundary. */
function seedLibrary(): void {
  prepareRuntimeDatabase(central)
  const accounts = new DatabaseSync(central)
  accounts
    .prepare('INSERT INTO accounts VALUES (?, ?, ?, ?)')
    .run(previousOwnerAccount, issuer.href, owner.id, 'Synthetic owner')
  accounts.close()
  provisionTestWorkspace(central, join(data, 'users'), previousOwnerAccount)
  const input = bank()
  input.questions = Array.from({ length: 20 }, (_, index) => ({
    ...structuredClone(input.questions[0]!),
    source_ref: String(index),
    question: `Synthetic seed ${index}?`,
  }))
  const shared = new LibraryRepository(central)
  const personal = new LibraryRepository(
    join(data, 'users', `${previousOwnerAccount}.sqlite3`),
    previousOwnerAccount,
    { privateOwnerId: previousOwnerAccount, deploymentRoot: data },
  )
  try {
    const importer = new ImportService(shared)
    importer.confirm(input, importer.preview(input).token, false)
    const study = shared.forAccount(previousOwnerAccount, personal)
    const service = new QuizService(study)
    const quiz = service.start({
      provider: 'Example',
      certification: 'DEMO-1',
      sourceFilter: 'mixed',
      questionType: 'mixed',
    })
    service.submit(quiz.id, {
      answers: quiz.questions.map((question) => ({
        questionId: question.questionId,
        selected: [],
        confidence: 'Unsure',
        flagged: false,
      })),
    })
    study
      .certificationStore()
      .setEarned({ provider: 'Example', code: 'DEMO-1', name: 'Example' }, true)
  } finally {
    personal.close()
    shared.close()
  }
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
  for (const actor of [signedIn, student, secondAdmin]) {
    const user = await currentUser(actor.browser)
    provisionTestWorkspace(central, join(data, 'users'), user.id)
  }
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

  const privateBank = bank('student-private')
  privateBank.source.name = 'Student private bank'
  privateBank.questions = Array.from({ length: 20 }, (_, index) => ({
    ...structuredClone(privateBank.questions[0]!),
    source_ref: String(index),
    question: `Private ${other.id} sample ${index}?`,
  }))
  const privatePreview = await studyJson(student.browser, '/api/private/imports/preview', {
    method: 'POST',
    body: JSON.stringify({ bank: privateBank }),
  })
  const privateConfirmation = {
    method: 'POST',
    body: JSON.stringify({ bank: privateBank, token: privatePreview.token, reviewed: false }),
  }
  assert.equal(
    (await study(secondAdmin.browser, '/api/private/imports/confirm', privateConfirmation)).status,
    409,
  )
  assert.equal(
    (await study(student.browser, '/api/private/imports/confirm', privateConfirmation)).status,
    201,
  )
  assert.equal((await studyJson(signedIn.browser, '/api/private/questions')).total, 0)
  assert.equal((await studyJson(student.browser, '/api/private/questions')).total, 20)
  assert.equal((await studyJson(student.browser, '/api/shared/questions')).total, 21)
  const availableSources = await studyJson(student.browser, '/api/sources')
  assert.ok(
    availableSources.some(
      (source: { id: unknown; visibility: string }) =>
        source.id === 'private:1' && source.visibility === 'private',
    ),
  )
  const privateStarted = await study(student.browser, '/api/quizzes', {
    method: 'POST',
    body: JSON.stringify({
      provider: 'Example',
      certification: 'DEMO-1',
      sourceFilter: 'mixed',
      questionType: 'mixed',
      sourceIds: ['private:1'],
    }),
  })
  assert.equal(privateStarted.status, 201)
  const privateQuiz = await privateStarted.json()
  assert.ok(
    privateQuiz.questions.every(
      (question: { sourceId: unknown }) => question.sourceId === 'private:1',
    ),
  )
  assert.equal((await study(signedIn.browser, '/api/quizzes/' + privateQuiz.id)).status, 404)
  const privateAnswers = privateQuiz.questions.map((question: { questionId: number }) => ({
    questionId: question.questionId,
    selected: [],
    confidence: 'Unsure',
    flagged: false,
  }))
  assert.equal(
    (
      await study(student.browser, `/api/quizzes/${privateQuiz.id}/submit`, {
        method: 'POST',
        body: JSON.stringify({ answers: privateAnswers }),
      })
    ).status,
    200,
  )
  const storageCheck = `
    import assert from 'node:assert/strict'
    import { readFileSync, statSync } from 'node:fs'
    import { DatabaseSync } from 'node:sqlite'
    const shared = new DatabaseSync('/data/central.sqlite3', { readOnly: true })
    assert.equal(shared.prepare('SELECT count(*) AS total FROM quiz_sessions').get().total, 0)
    assert.equal(shared.prepare('SELECT count(*) AS total FROM earned_certifications').get().total, 0)
    shared.close()
    const path = '/data/users/' + ${JSON.stringify(studentSession.id)} + '.sqlite3'
    const personal = new DatabaseSync(path, { readOnly: true })
    assert.equal(personal.prepare('SELECT count(*) AS total FROM quiz_sessions').get().total, 2)
    assert.equal(personal.prepare('SELECT count(*) AS total FROM questions').get().total, 20)
    personal.close()
    const privateQuestion = ${JSON.stringify(privateBank.questions[0]!.question)}
    assert.equal(readFileSync('/data/central.sqlite3').includes(Buffer.from(privateQuestion)), false)
    assert.equal(readFileSync(path).includes(Buffer.from(privateQuestion)), true)
    assert.equal(statSync(path).mode & 0o777, 0o600)
  `
  compose('exec', '-T', 'study', 'node', '--input-type=module', '-e', storageCheck)
  assert.equal(
    (await study(student.browser, '/api/private/sources/1', { method: 'DELETE' })).status,
    204,
  )
  const deletedPrivateResult = await studyJson(student.browser, '/api/quizzes/' + privateQuiz.id)
  assert.deepEqual(deletedPrivateResult.deletedBankNames, ['Student private bank'])
  assert.equal(deletedPrivateResult.questions.length, 20)
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
  const preservedPrivateResult = await studyJson(student.browser, '/api/quizzes/' + privateQuiz.id)
  assert.deepEqual(preservedPrivateResult, {
    ...deletedPrivateResult,
    serverNow: preservedPrivateResult.serverNow,
  })
  assert.deepEqual(await history(signedIn.browser), originalHistory)
  assert.equal((await history(student.browser)).length, 2)
  console.log(
    JSON.stringify({
      adminAndStudentLogin: true,
      preparedOwnerHistory: 1,
      privateStudentHistory: 2,
      sharedQuestions: 21,
      studentMutationDenied: true,
      crossAccountPreviewDenied: true,
      staleWorkspaceDenied: true,
      sessionsSurviveRecreation: true,
      privateBankIsolation: true,
      physicalHistorySeparation: true,
      privateDeletionPreservesResult: true,
    }),
  )
} finally {
  try {
    compose('down', '--volumes', '--remove-orphans')
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}
