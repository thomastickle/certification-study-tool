import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readThemePreference, saveThemePreference } from './theme.ts'

test('missing and invalid browser preferences follow the system', () => {
  for (const value of [null, '', 'sepia', 'system']) {
    assert.equal(readThemePreference({ getItem: () => value }), 'system')
  }
  for (const value of ['light', 'dark']) {
    assert.equal(readThemePreference({ getItem: () => value }), value)
  }
})

test('explicit choices persist and system removes the override', () => {
  const values = new Map<string, string>()
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value)
    },
    removeItem: (key: string) => {
      values.delete(key)
    },
  }
  saveThemePreference('dark', storage)
  assert.equal(readThemePreference(storage), 'dark')
  saveThemePreference('light', storage)
  assert.equal(readThemePreference(storage), 'light')
  saveThemePreference('system', storage)
  assert.equal(values.size, 0)
  assert.equal(readThemePreference(storage), 'system')
})

test('blocked storage does not prevent using the theme control', () => {
  const storage = {
    getItem: () => {
      throw new Error('Blocked')
    },
    setItem: () => {
      throw new Error('Blocked')
    },
    removeItem: () => {
      throw new Error('Blocked')
    },
  }
  assert.equal(readThemePreference(storage), 'system')
  assert.doesNotThrow(() => saveThemePreference('dark', storage))
  assert.doesNotThrow(() => saveThemePreference('system', storage))
})

test('the first-paint bootstrap applies only valid overrides before React loads', async () => {
  const { readFileSync } = await import('node:fs')
  const { runInNewContext } = await import('node:vm')
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
  const script = html.match(/<script>([\s\S]*?)<\/script>/)![1]!
  for (const value of ['light', 'dark', 'invalid', null]) {
    const document = { documentElement: { dataset: {} as Record<string, string> } }
    runInNewContext(script, { document, localStorage: { getItem: () => value } })
    assert.equal(
      document.documentElement.dataset.theme,
      value === 'light' || value === 'dark' ? value : undefined,
    )
  }
  assert.doesNotThrow(() => runInNewContext(script, {}))
})

test('palette choices persist independently of appearance and reject unknown palettes', async () => {
  const { readPalette, savePalette } = await import('./theme.ts')
  const values = new Map<string, string>()
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value)
    },
    removeItem: (key: string) => {
      values.delete(key)
    },
  }
  assert.equal(readPalette(storage), 'blue')
  saveThemePreference('dark', storage)
  savePalette('forest', storage)
  assert.equal(readPalette(storage), 'forest')
  assert.equal(readThemePreference(storage), 'dark')
  savePalette('violet', storage)
  assert.equal(readPalette(storage), 'violet')
  savePalette('blue', storage)
  assert.equal(values.has('study-palette'), false)
  values.set('study-palette', 'unknown')
  assert.equal(readPalette(storage), 'blue')
})
