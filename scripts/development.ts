import { spawn } from 'node:child_process'
import { watch, type FSWatcher } from 'node:fs'
import { once } from 'node:events'

const watchedDirectories = ['src/server', 'src/shared', 'docs', 'scripts']
const watchedRootFiles = new Set(['package.json', 'tsconfig.json', 'tsconfig.server.json'])
const npmCli = process.env.npm_execpath

if (!npmCli) {
  throw new Error('Run development through npm run dev.')
}

const buildCommand = [npmCli, 'run', 'build:server']
let stopping = false
let restartRequested = false
let debounceTimer: NodeJS.Timeout | undefined
let finishRestartDebounce: (() => void) | undefined
let activeChild: ReturnType<typeof spawn> | undefined
const watchers: FSWatcher[] = []
const rootFileWatchers = new Map<string, FSWatcher>()

/** Start one server generation, rebuilding first and restarting after source changes. */
async function runDevelopment(): Promise<void> {
  while (!stopping) {
    restartRequested = false
    const buildStatus = await runChild(process.execPath, buildCommand)
    if (stopping) {
      return
    }
    if (restartRequested) {
      await waitForRestart()
      continue
    }
    if (buildStatus !== 0) {
      console.error(`Server build exited with status ${buildStatus}. Waiting for a source change.`)
      await waitForRestart()
      continue
    }

    const server = spawn(process.execPath, ['build/src/server/main.js'], { stdio: 'inherit' })
    activeChild = server
    const [code, signal] = await once(server, 'exit')
    activeChild = undefined
    if (stopping) {
      return
    }
    if (restartRequested) {
      await waitForRestart()
      continue
    }

    console.error(`Development server exited (${signal ?? code}).`)
    stopping = true
  }
}

/** Run a build child and return its exit status, treating signals as failures. */
async function runChild(command: string, args: string[]): Promise<number> {
  const child = spawn(command, args, { stdio: 'inherit' })
  activeChild = child
  const [code, signal] = await once(child, 'exit')
  activeChild = undefined
  return code ?? (signal ? 1 : 0)
}

/** Wait until the source-change debounce has stopped the previous generation. */
function waitForRestart(): Promise<void> {
  return new Promise((resolve) => {
    if (!debounceTimer) {
      resolve()
      return
    }
    const finish = finishRestartDebounce
    finishRestartDebounce = () => {
      finish?.()
      resolve()
    }
  })
}

/** Debounce noisy editor writes and stop a running generation before rebuilding. */
function requestRestart(): void {
  if (stopping) {
    return
  }

  restartRequested = true
  clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    debounceTimer = undefined
    activeChild?.kill('SIGTERM')
    finishRestartDebounce?.()
    finishRestartDebounce = undefined
  }, 100)
}

/** Follow editor saves that replace a root configuration file with a new inode. */
function watchRootFile(fileName: string): void {
  rootFileWatchers.get(fileName)?.close()
  rootFileWatchers.set(fileName, watch(fileName, requestRestart))
}

for (const directory of watchedDirectories) {
  watchers.push(
    watch(directory, { recursive: true }, (_event, filename) => {
      if (filename) {
        requestRestart()
      }
    }),
  )
}

watchers.push(
  watch('.', (_event, filename) => {
    const changedFile = filename?.toString()
    if (changedFile && watchedRootFiles.has(changedFile)) {
      requestRestart()
      watchRootFile(changedFile)
    }
  }),
)
for (const fileName of watchedRootFiles) {
  watchRootFile(fileName)
}

/** Relay termination to the active build or server, then close every watcher. */
function stop(signal: NodeJS.Signals): void {
  if (stopping) {
    return
  }

  stopping = true
  clearTimeout(debounceTimer)
  debounceTimer = undefined
  finishRestartDebounce?.()
  finishRestartDebounce = undefined
  for (const watcher of watchers) {
    watcher.close()
  }
  for (const watcher of rootFileWatchers.values()) {
    watcher.close()
  }
  activeChild?.kill(signal)
}

process.once('SIGINT', stop)
process.once('SIGTERM', stop)
await runDevelopment()
