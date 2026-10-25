import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { lockDataDirectory } from '../src/server/auth/data-lock.ts'

test('data ownership excludes concurrent server/maintenance access and releases without stale files', () => {
  const directory = mkdtempSync(join(tmpdir(), 'study-data-lock-'))
  try {
    const release = lockDataDirectory(directory)
    try {
      assert.throws(() => lockDataDirectory(directory), /in use/)
    } finally {
      release()
    }
    const releaseAgain = lockDataDirectory(directory)
    releaseAgain()
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
