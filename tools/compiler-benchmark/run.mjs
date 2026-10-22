import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { measure, summarize, summarizeResources, writeSummary } from './measure.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
process.umask(0o077)
const privateRoot = join(root, 'private/ai-runs')
mkdirSync(privateRoot, { recursive: true, mode: 0o700 })
chmodSync(join(root, 'private'), 0o700)
chmodSync(privateRoot, 0o700)
const output = mkdtempSync(join(privateRoot, 'compiler-benchmark-'))
const checkerArgs = ['--project', 'tsconfig.json', '--noEmit', '--pretty', 'false']
const checkers = [
  { name: 'ts59', binary: join(root, 'node_modules/.bin/tsc') },
  { name: 'ts7', binary: join(root, 'tools/compiler-benchmark/node_modules/.bin/tsc') },
  { name: 'tsrs', binary: join(root, 'tools/compiler-benchmark/node_modules/.bin/tsrs') },
]
const vite = [join(root, 'node_modules/.bin/vite'), 'build']

/** Hash every emitted file, including its relative path, in deterministic order. */
function artifacts(directory) {
  const files = readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .sort()
  return files.map((file) => ({
    path: relative(directory, file),
    sha256: createHash('sha256').update(readFileSync(file)).digest('hex'),
  }))
}

/** Keep full command output private; return timing and diagnostic counts only. */
function run(label, commands) {
  const result = measure(commands, root)
  writeFileSync(join(output, `${label}.json`), JSON.stringify({ commands, ...result }, null, 2))
  return result
}

/** Count diagnostic codes without publishing source excerpts or local paths. */
function diagnostics(result) {
  const counts = {}
  for (const step of result.steps) {
    for (const match of `${step.stdout}\n${step.stderr}`.matchAll(/error TS(\d+):/g)) {
      counts[match[1]] = (counts[match[1]] ?? 0) + 1
    }
  }
  return counts
}

/** Require the fixture's assignment diagnostic, not just any failing exit. */
function rejectedProbe(result) {
  return (
    !result.ok &&
    result.steps.every((step) => !step.measurementError) &&
    result.steps.some((step) =>
      /bad-type-probe\.ts[^\n]*error TS2322:/.test(`${step.stdout}\n${step.stderr}`),
    )
  )
}

const metadata = {
  loadAverageStart: os.loadavg(),
  freeMemoryGiBStart: os.freemem() / 1024 ** 3,
  resourceTool: execFileSync('/usr/bin/time', ['--version'], { encoding: 'utf8' }).split('\n')[0],
  date: new Date().toISOString(),
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  platform: `${os.platform()} ${os.release()} ${os.arch()}`,
  cpu: os.cpus()[0]?.model,
  logicalCpus: os.cpus().length,
  availableParallelism: os.availableParallelism(),
  memoryGiB: os.totalmem() / 1024 ** 3,
  node: process.version,
  npm: execFileSync('npm', ['--version'], { encoding: 'utf8' }).trim(),
  vite: JSON.parse(readFileSync(join(root, 'node_modules/vite/package.json'), 'utf8')).version,
  configSha256: createHash('sha256')
    .update(readFileSync(join(root, 'tsconfig.json')))
    .digest('hex'),
  rootLockSha256: createHash('sha256')
    .update(readFileSync(join(root, 'package-lock.json')))
    .digest('hex'),
  warmups: 1,
  measuredRounds: 5,
  cache: 'Fresh processes; warmed filesystem cache; no cache flushing; no incremental/watch mode',
}
const preflight = {}
const fixture = join(output, 'bad-type-probe.ts')
const fixtureConfig = join(output, 'tsconfig.probe.json')
writeFileSync(fixture, 'export const intentionalTypeError: string = 123\n')
writeFileSync(
  fixtureConfig,
  JSON.stringify({
    extends: join(root, 'tsconfig.json'),
    include: [join(root, 'src'), join(root, 'tests'), join(root, 'vite.config.ts'), fixture],
  }),
)
try {
  for (const checker of checkers) {
    const version = run(`${checker.name}-version`, [[checker.binary, '--version']])
    const project = run(`${checker.name}-preflight`, [[checker.binary, ...checkerArgs]])
    const probe = run(`${checker.name}-probe`, [
      [checker.binary, '--project', fixtureConfig, '--noEmit', '--pretty', 'false'],
    ])
    preflight[checker.name] = {
      version: version.steps[0].stdout?.trim(),
      ok: version.ok && project.ok,
      statuses: project.steps.map((step) => step.status),
      diagnostics: diagnostics(project),
      probeRejected: rejectedProbe(probe),
      probeDiagnostics: diagnostics(probe),
    }
  }
} finally {
  rmSync(fixture, { force: true })
  rmSync(fixtureConfig, { force: true })
}
writeFileSync(join(output, 'preflight.json'), JSON.stringify(preflight, null, 2))
if (
  checkers.some((checker) => !preflight[checker.name].ok) ||
  checkers.some((checker) => !preflight[checker.name].probeRejected)
) {
  throw new Error(`Baseline/probe validation failed. Inspect ${output}`)
}
const baseline = run('vite-artifact-reference', [vite])
if (!baseline.ok) {
  throw new Error(`Vite baseline failed. Inspect ${output}`)
}
const reference = artifacts(join(root, 'dist'))
const cases = checkers.flatMap((checker) => {
  const commands = [[checker.binary, ...checkerArgs]]
  const entries = [{ name: `${checker.name}-check`, commands, builds: false }]
  if (preflight[checker.name].ok) {
    entries.push({ name: `${checker.name}-build`, commands: [...commands, vite], builds: true })
  }
  return entries
})
cases.push({ name: 'vite', commands: [vite], builds: true })
const samples = Object.fromEntries(cases.map((entry) => [entry.name, []]))
const order = []
const warmups = {}
for (let round = 0; round <= metadata.measuredRounds; round += 1) {
  const rotated = [...cases.slice(round % cases.length), ...cases.slice(0, round % cases.length)]
  order.push(rotated.map((entry) => entry.name))
  for (const entry of rotated) {
    const result = run(`round-${round}-${entry.name}`, entry.commands)
    let artifactMatch = null
    if (result.ok && entry.builds) {
      artifactMatch = JSON.stringify(artifacts(join(root, 'dist'))) === JSON.stringify(reference)
    }
    const sample = {
      ok: result.ok && artifactMatch !== false,
      ms: result.ms,
      resources: result.resources,
      measurementError: result.steps.some((step) => step.measurementError),
      phases: result.steps.map((step) => ({ ms: step.ms, resources: step.resources ?? null })),
      statuses: result.steps.map((step) => step.status),
      diagnostics: diagnostics(result),
      artifactMatch,
    }
    if (round > 0) {
      samples[entry.name].push(sample)
    } else {
      warmups[entry.name] = [sample]
    }
    if (artifactMatch === false) {
      throw new Error(`Artifact mismatch in ${entry.name}. Inspect ${output}`)
    }
    process.stdout.write(`Round ${round} ${entry.name}: ${result.ok ? 'pass' : 'failed'}\n`)
  }
}
metadata.loadAverageEnd = os.loadavg()
metadata.freeMemoryGiBEnd = os.freemem() / 1024 ** 3
const summary = {
  metadata,
  preflight,
  order,
  artifacts: reference,
  samples,
  warmups,
  resources: Object.fromEntries(
    Object.entries(samples).map(([name, results]) => [name, summarizeResources(results)]),
  ),
  timings: Object.fromEntries(
    Object.entries(samples).map(([name, results]) => [name, summarize(results)]),
  ),
}
writeSummary(join(output, 'summary.json'), summary)
process.stdout.write(`Private results: ${relative(root, output)}/summary.json\n`)
