import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { validateStaticAssets } from '../src/server/web/validate-static-assets.ts'

for (const unsafe of [
  'hidden file',
  'hidden directory',
  'outside link',
  'inside link',
  'root link',
]) {
  test(`static artifact validation rejects ${unsafe} without traversing it`, () => {
    const directory = mkdtempSync(join(tmpdir(), 'static-assets-'))
    const root = join(directory, 'dist')
    mkdirSync(root)
    writeFileSync(join(root, 'index.html'), 'shell')
    mkdirSync(join(root, 'assets'))
    writeFileSync(join(root, 'assets', 'app.js'), 'application')
    try {
      assert.doesNotThrow(() => validateStaticAssets(root))
      let selected = root
      if (unsafe === 'hidden file') {
        writeFileSync(join(root, 'assets', '.env'), 'synthetic private data')
      } else if (unsafe === 'hidden directory') {
        mkdirSync(join(root, '.private'))
      } else if (unsafe === 'root link') {
        selected = join(directory, 'linked-dist')
        symlinkSync(root, selected)
      } else {
        const target =
          unsafe === 'outside link' ? join(directory, 'outside') : join(root, 'index.html')
        symlinkSync(target, join(root, 'asset-link'))
      }
      assert.throws(() => validateStaticAssets(selected), /Unsafe static asset/)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
}
