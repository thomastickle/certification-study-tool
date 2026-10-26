import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'

test('owner smoke rejects unsafe or omitted ports before attempting Docker', () => {
  const cases = [
    ['http://127.0.0.1', 'http://127.0.0.1:8340/realms/study', /explicit isolated ports/],
    ['http://127.0.0.1:3340', 'http://127.0.0.1/realms/study', /explicit isolated ports/],
    [
      'http://127.0.0.1:3000',
      'http://127.0.0.1:8340/realms/study',
      /isolated integration-test port/,
    ],
    ['http://127.0.0.1:3340', 'http://127.0.0.1:3340/realms/study', /ports must differ/],
  ] as const
  for (const [app, issuer, message] of cases) {
    const result = spawnSync(
      process.execPath,
      [
        'tests/owner-login-smoke.ts',
        '--project',
        'study-login-refusal-test',
        '--app-url',
        app,
        '--issuer',
        issuer,
      ],
      { env: { ...process.env, PATH: '' }, encoding: 'utf8', timeout: 10_000 },
    )
    assert.equal(result.status, 1)
    assert.match(result.stderr, message)
    assert.doesNotMatch(result.stderr, /disposable Docker integration command failed/)
  }
})
