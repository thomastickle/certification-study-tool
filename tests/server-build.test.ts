import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'

test('server build emits runnable ESM and its schema separately from the web bundle', async () => {
  assert.ok(existsSync('build/src/server/main.js'), 'Compile the production entry point')
  const main = readFileSync('build/src/server/main.js', 'utf8')
  assert.match(main, /from ['"]\.\/legacy-transport\.js['"]/)
  assert.match(main, /from ['"]\.\/runtime\.module\.js['"]/)
  const transport = readFileSync('build/src/server/legacy-transport.js', 'utf8')
  assert.match(transport, /from ['"]\.\/http-controller\.js['"]/)
  assert.doesNotMatch(transport, /from ['"][^'"]+\.ts['"]/)
  assert.doesNotMatch(main, /from ['"][^'"]+\.ts['"]/)
  assert.deepEqual(
    readFileSync('build/docs/question-bank.schema.json'),
    readFileSync('docs/question-bank.schema.json'),
  )
  // A URL import keeps this native-TS test entirely on the compiled runtime graph.
  const validatorUrl = new URL('../build/src/server/importer/validate-bank.js', import.meta.url)
  const { validateBank } = await import(validatorUrl.href)
  assert.throws(() => validateBank({}), /The file failed validation/)
})
