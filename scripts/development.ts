import { spawn } from 'node:child_process'
import { watch, type FSWatcher } from 'node:fs'
import { once } from 'node:events'

const watchedDirectories = ['src/server', 'src/shared', 'docs', 'scripts']
const watchedRootFiles = new Set(['package.json', 'tsconfig.json', 'tsconfig.server.json'])

type ChildRole = 'build' | 'server'

let stopping = false
let changeVersion = 0
let activeChild: ReturnType<typeof spawn> | undefined
let activeChildRole: ChildRole | undefined
let debounceTimer: NodeJS.Timeout | undefined
const changeWaiters = new Set<() => void>()
const debounceWaiters = new Set<() => void>()
const watchers: FSWatcher[] = []
const rootFileWatchers = new Map<string, FSWatcher>()

/** Build serially and run one server generation at a time. */
async function runDevelopment(): Promise<void> {
  while (!stopping) {
    const buildVersion = changeVersion
    const build = await runChild(process.execPath, ['scripts/build-server.ts'], 'build')
    if (stopping) {
      return
    }
    if (changeVersion !== buildVersion) {
      await waitForDebounce()
      continue
    }
    if (build.code !== 0 || build.signal) {
      console.error(`Server build exited with status ${build.code ?? build.signal}.`)
      console.error('Waiting for a source change.')
      await waitForChange(changeVersion)
      await waitForDebounce()
      continue
    }

    const serverVersion = changeVersion
    const server = await runChild(process.execPath, ['build/src/server/main.js'], 'server')
    if (stopping) {
      return
    }
    if (changeVersion !== serverVersion) {
      await waitForDebounce()
      continue
    }

    console.error(`Development server exited (${server.signal ?? server.code}).`)
    console.error('Waiting for a source change.')
    await waitForChange(changeVersion)
    await waitForDebounce()
  }
}

/** Spawn an owned phase and wait for its exit before changing generations. */
async function runChild(
  command: string,
  args: string[],
  role: ChildRole,
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  const child = spawn(command, args, { stdio: 'inherit' })
  activeChild = child
  activeChildRole = role
  try {
    const [code, signal] = await once(child, 'exit')
    return {
      code: code as number | null,
      signal: signal as NodeJS.Signals | null,
    }
  } catch (error) {
    console.error(`${role === 'build' ? 'Server build' : 'Development server'} could not start.`)
    console.error(error instanceof Error ? error.message : 'Unknown child-process error.')
    return { code: 1, signal: null }
  } finally {
    if (activeChild === child) {
      activeChild = undefined
      activeChildRole = undefined
    }
  }
}

/** Wait until a new source event occurs, or shutdown releases the waiter. */
function waitForChange(afterVersion: number): Promise<void> {
  if (stopping || changeVersion !== afterVersion) {
    return Promise.resolve()
  }

  return new Promise((resolve) => {
    changeWaiters.add(resolve)
  })
}

/** Wait for the trailing edge of the source-event debounce. */
function waitForDebounce(): Promise<void> {
  if (!debounceTimer) {
    return Promise.resolve()
  }

  return new Promise((resolve) => {
    debounceWaiters.add(resolve)
  })
}

/** Debounce edits and stop only a running server; active builds finish before rebuilding. */
function requestRestart(): void {
  if (stopping) {
    return
  }

  changeVersion += 1
  for (const resolve of changeWaiters) {
    resolve()
  }
  changeWaiters.clear()

  clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    debounceTimer = undefined
    if (activeChildRole === 'server') {
      activeChild?.kill('SIGTERM')
    }
    for (const resolve of debounceWaiters) {
      resolve()
    }
    debounceWaiters.clear()
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

/** Close every watcher and stop the server; allow an active compiler to finish. */
function stop(signal: NodeJS.Signals): void {
  if (stopping) {
    return
  }

  stopping = true
  clearTimeout(debounceTimer)
  debounceTimer = undefined
  for (const resolve of changeWaiters) {
    resolve()
  }
  changeWaiters.clear()
  for (const resolve of debounceWaiters) {
    resolve()
  }
  debounceWaiters.clear()

  for (const watcher of watchers) {
    watcher.close()
  }
  for (const watcher of rootFileWatchers.values()) {
    watcher.close()
  }

  if (activeChildRole === 'server') {
    activeChild?.kill(signal)
  }
}

process.once('SIGINT', stop)
process.once('SIGTERM', stop)
await runDevelopment()
