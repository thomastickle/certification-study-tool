import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, rmSync } from 'node:fs'

// Remove stale modules before emit, including controllers/tests removed since the last build.
rmSync('build', { recursive: true, force: true })
const compiler = 'node_modules/typescript/bin/tsc6'
const result = spawnSync(process.execPath, [compiler, '-p', 'tsconfig.server.json'], {
  stdio: 'inherit',
})
if (result.status !== 0) {
  process.exit(result.status ?? 1)
}
// Preserve the schema's module-relative path in both source and compiled graphs.
mkdirSync('build/docs', { recursive: true })
copyFileSync('docs/question-bank.schema.json', 'build/docs/question-bank.schema.json')
