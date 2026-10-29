import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'

test('server build emits runnable ESM and its schema separately from the web bundle', async () => {
  assert.ok(existsSync('build/src/server/main.js'), 'Compile the production entry point')
  const main = readFileSync('build/src/server/main.js', 'utf8')
  // Production now composes the real Nest controllers, not the transitional legacy listener.
  assert.match(main, /from ['"]\.\/production-application\.js['"]/)
  assert.doesNotMatch(main, /legacy-transport|apiController|createApplicationContext/)
  const composition = readFileSync('build/src/server/production-application.js', 'utf8')
  assert.match(composition, /LibraryHttpModule/)
  assert.match(composition, /StudyHttpModule/)
  assert.match(composition, /PublicWeb/)
  assert.doesNotMatch(composition, /legacy-transport|http-controller/)
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
