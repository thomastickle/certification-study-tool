import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { ESLint } from 'eslint'

const npmCli = process.env.npm_execpath
assert.ok(npmCli, 'Run toolchain tests through npm test or npm exec')

test('default typecheck runs TypeScript 7 native', () => {
  const result = spawnSync(process.execPath, [npmCli, 'run', 'typecheck', '--', '--version'], {
    encoding: 'utf8',
  })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /Version 7\./)
})

test('default typecheck accepts valid TypeScript and rejects a type error', () => {
  const directory = mkdtempSync(join(tmpdir(), 'study-typecheck-'))
  try {
    writeFileSync(join(directory, 'tsconfig.json'), '{"compilerOptions":{"strict":true}}')
    const source = join(directory, 'probe.ts')
    const args = [npmCli, 'run', 'typecheck', '--', '--project', directory]
    writeFileSync(source, 'const count: number = 1\n')
    const valid = spawnSync(process.execPath, args, { encoding: 'utf8' })
    assert.equal(valid.status, 0, valid.stdout + valid.stderr)

    writeFileSync(source, 'const count: number = "invalid"\n')
    const invalid = spawnSync(process.execPath, args, { encoding: 'utf8' })
    assert.ok(invalid.status !== null && invalid.status !== 0, invalid.stdout + invalid.stderr)
    assert.match(invalid.stdout, /TS2322/)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('ESLint has a working TypeScript API and enforces TypeScript rules', async () => {
  const require = createRequire(import.meta.url)
  const parserRequire = createRequire(require.resolve('@typescript-eslint/typescript-estree'))
  const ts = parserRequire('typescript') as typeof import('typescript')
  const source = ts.createSourceFile('probe.ts', 'const count: number = 1', ts.ScriptTarget.Latest)
  assert.equal(source.statements.length, 1)
  assert.ok(ts.isVariableStatement(source.statements[0]!))

  const eslint = new ESLint()
  const valid = await eslint.lintText('export const count: number = 1\n', {
    filePath: 'src/toolchain-probe.ts',
  })
  assert.equal(valid[0]?.errorCount, 0)
  assert.equal(valid[0]?.warningCount, 0)

  const invalid = await eslint.lintText('const unused: any = 1\n', {
    filePath: 'src/toolchain-probe.ts',
  })
  const rules = invalid[0]?.messages.map((message) => message.ruleId)
  assert.ok(rules?.includes('@typescript-eslint/no-explicit-any'))
  assert.ok(rules?.includes('@typescript-eslint/no-unused-vars'))
})
