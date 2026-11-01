import { spawn } from 'node:child_process'
import { closeSync, existsSync, openSync, readFileSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { writePrivate } from './network-files.ts'
import { validateProfile } from './network-profile.ts'
import type { NetworkProfile } from './network-profile.ts'

type Advertisement = { pid: number; hostname: string; address: string }

/**
 * Stop only the process whose complete arguments match this project's recorded mDNS publication.
 * @throws {Error} For a malformed ownership record or an unexpected process-inspection failure.
 */
export function stopAdvertisement(directory: string): void {
  const path = join(directory, 'publisher.json')
  if (!existsSync(path)) {
    return
  }
  const publisher = JSON.parse(readFileSync(path, 'utf8')) as Advertisement
  if (!Number.isSafeInteger(publisher.pid) || publisher.pid <= 0) {
    throw new Error('Invalid mDNS ownership record; inspect it before retrying.')
  }
  try {
    const arguments_ = readFileSync(`/proc/${publisher.pid}/cmdline`, 'utf8')
      .split('\0')
      .filter(Boolean)
    const expected = ['avahi-publish-address', '-R', publisher.hostname, publisher.address]
    if (arguments_.join('\0') === expected.join('\0')) {
      process.kill(publisher.pid, 'SIGTERM')
    }
  } catch (error) {
    if (!['ENOENT', 'ESRCH'].includes((error as NodeJS.ErrnoException).code ?? '')) {
      throw error
    }
  }
  rmSync(path)
}

/**
 * Publish only the selected home address and wait for Avahi to confirm registration.
 * @throws {Error} When the installed Avahi tool cannot establish the name; removes only its own process.
 */
export async function startAdvertisement(
  directory: string,
  profile: NetworkProfile,
): Promise<void> {
  validateProfile(profile)
  stopAdvertisement(directory)
  const path = join(directory, 'mdns.log')
  const output = openSync(path, 'a', 0o600)
  const offset = statSync(path).size
  let spawnError: Error | undefined
  try {
    const publisher = spawn('avahi-publish-address', ['-R', profile.hostname, profile.address], {
      detached: true,
      stdio: ['ignore', output, output],
    })
    publisher.once('error', (error) => {
      spawnError = error
    })
    publisher.unref()
    if (!publisher.pid) {
      throw new Error('The installed avahi-publish-address command is required for LAN naming.')
    }
    writePrivate(
      join(directory, 'publisher.json'),
      JSON.stringify({ pid: publisher.pid, hostname: profile.hostname, address: profile.address }),
    )
  } finally {
    closeSync(output)
  }
  for (let attempt = 0; attempt < 50; attempt += 1) {
    await delay(100)
    if (spawnError) {
      stopAdvertisement(directory)
      throw spawnError
    }
    if (
      readFileSync(path)
        .subarray(offset)
        .toString()
        .includes(`Established under name '${profile.hostname}'`)
    ) {
      return
    }
  }
  stopAdvertisement(directory)
  throw new Error(
    'mDNS publication did not become ready. See the private mdns.log for the conflict or daemon failure.',
  )
}
