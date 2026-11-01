import assert from 'node:assert/strict'
import { mkdtempSync, existsSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { stopAdvertisement } from '../scripts/network-publisher.ts'

test('stale mDNS ownership records never signal an unrelated process or process group', (testContext) => {
  const root = mkdtempSync(join(tmpdir(), 'study-network-publisher-'))
  testContext.after(() => rmSync(root, { recursive: true, force: true }))
  const record = join(root, 'publisher.json')
  writeFileSync(
    record,
    JSON.stringify({ pid: process.pid, hostname: 'unowned.local', address: '192.168.1.10' }),
  )
  stopAdvertisement(root)
  assert.equal(existsSync(record), false)
  writeFileSync(
    record,
    JSON.stringify({ pid: 0, hostname: 'invalid.local', address: '192.168.1.10' }),
  )
  assert.throws(() => stopAdvertisement(root), /ownership record/)
  assert.equal(existsSync(record), true)
})
