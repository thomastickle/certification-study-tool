import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { parseArgs } from 'node:util'

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
  private cookies = new Map<string, { value: string; path: string }>()

  async request(url: URL | string, options: RequestInit = {}): Promise<Response> {
    const target = new URL(url)
    assert.ok(
      [app.origin, issuer.origin].includes(target.origin),
      'Unexpected redirect outside the test stack.',
    )
    const headers = new Headers(options.headers)
    headers.set(
      'Cookie',
      [...this.cookies]
        .filter(([, cookie]) => target.pathname.startsWith(cookie.path))
        .map(([name, cookie]) => `${name}=${cookie.value}`)
        .join('; '),
    )
    const response = await fetch(target, { ...options, headers, redirect: 'manual' })
    for (const raw of response.headers.getSetCookie()) {
      const [pair, ...attributes] = raw.split(';')
      const split = pair!.indexOf('=')
      const name = pair!.slice(0, split)
      const value = pair!.slice(split + 1)
      const path =
        attributes
          .find((part) => /^\s*path=/i.test(part))
          ?.trim()
          .slice(5) ?? '/'
      this.cookies.set(name, { value, path })
    }
    return response
  }

  async follow(url: URL | string): Promise<Response> {
    let current = new URL(url)
    for (let hop = 0; hop < 12; hop++) {
      const response = await this.request(current)
      if (![301, 302, 303].includes(response.status)) return response
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

/** Submit the pinned Keycloak HTML forms, exercising the app's real code/PKCE callback. */
async function authenticate(
  username: string,
  password: string,
  register: boolean,
): Promise<{ browser: Browser; id: string }> {
  const browser = new Browser()
  const start = await browser.request(new URL('/auth/login', app))
  assert.equal(start.status, 302)
  const loginUrl = new URL(start.headers.get('location')!)
  const login = await browser.follow(loginUrl)
  assert.equal(login.status, 200)
  let html = await login.text()
  let formUrl = loginUrl
  if (register) {
    const path = attribute(html, /href="([^"]*login-actions\/registration[^"]*)"/)
    formUrl = new URL(path, issuer)
    const registration = await browser.follow(formUrl)
    assert.equal(registration.status, 200)
    html = await registration.text()
  }
  const form = html.match(/<form\b[^>]*id="kc-(?:register|form-login)[^"]*"[^>]*>/)?.[0]
  assert.ok(form, 'Expected the Keycloak account form.')
  const action = new URL(attribute(form, /action="([^"]+)"/), formUrl)
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
  const landing = await browser.follow(new URL(submitted.headers.get('location')!, action))
  assert.equal(landing.status, 200)
  const session = await (await browser.request(new URL('/api/session', app))).json()
  assert.ok(session.user?.id, 'The real OIDC callback did not establish a user session.')
  return { browser, id: session.user.id }
}

async function api<T>(client: { browser: Browser; id: string }, path: string): Promise<T> {
  const response = await client.browser.request(new URL('/api' + path, app), {
    headers: { 'X-Study-Account': client.id },
  })
  assert.equal(response.status, 200)
  return response.json()
}

const seed = `
import { existsSync } from 'node:fs';
import { LibraryRepository } from './src/server/questions/library-repository.ts';
import { ImportService } from './src/server/importer/import-service.ts';
import { QuizService } from './src/server/quizzes/quiz-service.ts';
if (existsSync('/data/library.sqlite3')) throw new Error('Use a fresh disposable volume for the rollout smoke test.');
const repo = new LibraryRepository('/data/library.sqlite3');
const bank = {schema_version:2,certification:{provider:'Example',code:'DEMO-1',name:'Legacy rollout fixture'},source:{key:'legacy-rollout',name:'Synthetic legacy rollout',type:'third_party',verification_status:'unverified'},questions:Array.from({length:20},(_,i)=>({source_ref:String(i),question:'Synthetic legacy question '+i+'?',type:'single_select',select_count:1,answers:[{text:'Correct example',correct:true},{text:'Other example',correct:false}]}))};
const importer = new ImportService(repo); importer.confirm(bank, importer.preview(bank).token, false);
const service = new QuizService(repo); const quiz = service.start({provider:'Example',certification:'DEMO-1',sourceFilter:'mixed',questionType:'mixed'});
service.submit(quiz.id,{answers:quiz.questions.map(q=>({questionId:q.questionId,selected:[],confidence:'Unsure',flagged:false}))});
repo.certificationStore().setEarned({provider:'Example',code:'DEMO-1',name:'Legacy rollout fixture'},true);
repo.close();
`

const sourceHash = () =>
  run(
    'node',
    '--input-type=module',
    '-e',
    "import {readFileSync} from 'node:fs'; import {createHash} from 'node:crypto'; console.log(createHash('sha256').update(readFileSync('/data/library.sqlite3')).digest('hex'))",
  ).trim()

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

try {
  compose('stop', 'study')
  run('node', '--input-type=module', '-e', seed)
  const before = sourceHash()
  compose('up', '--no-build', '-d', '--wait', '--wait-timeout', '180')
  const username = 'rollout-owner-' + randomUUID().slice(0, 8)
  const password = randomUUID() + '!aA1'
  const owner = await authenticate(username, password, true)
  const other = await authenticate(
    'rollout-other-' + randomUUID().slice(0, 8),
    randomUUID() + '!aA1',
    true,
  )
  assert.equal((await api<{ total: number }>(owner, '/questions')).total, 0)
  assert.equal((await api<{ total: number }>(other, '/questions')).total, 0)
  assert.throws(() => migration(owner.id, true), /in use/)
  compose('stop', 'study')
  assert.equal(migration(owner.id).applied, false)
  const result = migration(owner.id, true)
  assert.equal(result.applied, true)
  assert.ok(result.backup)
  assert.equal(sourceHash(), before)
  compose('up', '--no-build', '-d', '--wait', '--wait-timeout', '180')
  assert.equal((await api<{ total: number }>(owner, '/questions')).total, 20)
  assert.equal(
    (await api<unknown[]>(owner, '/quizzes?provider=Example&certification=DEMO-1')).length,
    1,
  )
  assert.equal((await api<{ total: number }>(other, '/questions')).total, 0)
  compose('up', '--no-build', '--force-recreate', '-d', '--wait', '--wait-timeout', '180')
  const signedInAgain = await authenticate(username, password, false)
  assert.equal(signedInAgain.id, owner.id)
  assert.equal((await api<{ total: number }>(signedInAgain, '/questions')).total, 20)
  assert.equal((await api<{ total: number }>(other, '/questions')).total, 0)
  assert.equal(sourceHash(), before)
  console.log(
    JSON.stringify({
      login: 'passed',
      migratedQuestions: 20,
      completedHistory: 1,
      otherUserQuestions: 0,
      usersAndDataSurviveRecreation: true,
      legacySourceUnchanged: true,
    }),
  )
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Rollout smoke test failed.')
  process.exitCode = 1
}
