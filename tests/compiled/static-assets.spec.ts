import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Server } from 'node:http'
import { test } from 'node:test'
import { PublicWeb } from '../../src/server/web/public-web.ts'
import type { RuntimeConfiguration } from '../../src/server/runtime/runtime-configuration.ts'

test('production public serving refuses an unsafe distribution before exposing it', async () => {
  const root = mkdtempSync(join(tmpdir(), 'static-startup-'))
  writeFileSync(join(root, 'index.html'), 'shell')
  writeFileSync(join(root, '.env'), 'synthetic fixture')
  const config = { production: true, staticRoot: root } as RuntimeConfiguration
  try {
    await assert.rejects(new PublicWeb().initialize({} as Server, config), /Unsafe static asset/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
