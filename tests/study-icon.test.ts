import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'

test('study icons remain inline, decorative, theme-colored and scalable', async () => {
  const hooks = registerHooks({
    load(url, context, nextLoad) {
      if (!url.startsWith('file:') || !url.endsWith('.tsx')) {
        return nextLoad(url, context)
      }
      return {
        format: 'module',
        source: ts.transpileModule(readFileSync(fileURLToPath(url), 'utf8'), {
          compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext },
        }).outputText,
        shortCircuit: true,
      }
    },
  })
  try {
    const { StudyIcon } = await import('../src/web/shared/ui/StudyIcon.tsx')
    const names = [
      'settings',
      'trash',
      'undo',
      'home',
      'practice',
      'quiz',
      'exam',
      'review',
      'importer',
      'reports',
      'cloud',
      'arrow',
      'chevron',
      'sidebar',
    ] as const
    for (const name of names) {
      const html = renderToStaticMarkup(createElement(StudyIcon, { name }))
      assert.match(html, /class="study-icon"/, name)
      assert.match(html, /<svg\b/, name)
      assert.match(html, /viewBox="0 0 24 24"/, name)
      assert.match(html, /stroke="currentColor"/, name)
      assert.match(html, /aria-hidden="true"/, name)
      assert.match(html, /focusable="false"/, name)
      assert.match(html, /<path\s+d="[^"]+"/, name)
      assert.doesNotMatch(html, /<img|<script|\bon\w+=/, name)
    }
  } finally {
    hooks.deregister()
  }
})
