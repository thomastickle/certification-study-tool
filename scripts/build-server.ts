import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { copyFileSync, cpSync, mkdirSync, rmSync } from 'node:fs'

// Remove stale modules before emit, including controllers/tests removed since the last build.
rmSync('build', { recursive: true, force: true })
const compiler = 'node_modules/typescript/bin/tsc6'
const child = spawn(process.execPath, [compiler, '-p', 'tsconfig.server.json'], {
  stdio: 'inherit',
})
let interrupted = false

/** Forward terminal signals to TypeScript and await its exit before this build process ends. */
function interrupt(signal: NodeJS.Signals): void {
  interrupted = true
  child.kill(signal)
}

process.once('SIGINT', interrupt)
process.once('SIGTERM', interrupt)
const [status, signal] = await once(child, 'exit')
process.off('SIGINT', interrupt)
process.off('SIGTERM', interrupt)

if (interrupted || signal || status !== 0) {
  process.exitCode = status ?? 1
  if (process.exitCode === 0) {
    process.exitCode = 1
  }
} else {
  cpSync('database/migrations', 'build/database/migrations', { recursive: true })
  // Preserve the schema's module-relative path in both source and compiled graphs.
  mkdirSync('build/docs', { recursive: true })
  copyFileSync('docs/question-bank.schema.json', 'build/docs/question-bank.schema.json')
}
