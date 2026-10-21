import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'

test('result indicators label exact score boundaries, missing evidence, and paused attempts', async () => {
  const hooks = registerHooks({
    load(url, context, nextLoad) {
      if (!url.startsWith('file:') || !url.endsWith('.tsx')) return nextLoad(url, context)
      const source = ts.transpileModule(readFileSync(fileURLToPath(url), 'utf8'), {
        compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext },
      }).outputText
      return { format: 'module', source, shortCircuit: true }
    },
  })
  try {
    const { ResultIndicator } = await import('./ResultIndicator.tsx')
    for (const [correctCount, total, label] of [
      [0, 20, '0–69%'],
      [6999, 10000, '0–69%'],
      [70, 100, '70–89%'],
      [8999, 10000, '70–89%'],
      [90, 100, '90–100%'],
      [9001, 10000, '90–100%'],
      [20, 20, '90–100%'],
      [null, 20, 'Score unavailable'],
      [0, 0, 'Score unavailable'],
    ] as const) {
      const html = renderToStaticMarkup(
        createElement(ResultIndicator, { status: 'completed', correctCount, total }),
      )
      assert.ok(html.includes(`aria-label="${label}"`), `${correctCount}/${total}: ${html}`)
    }
    const paused = renderToStaticMarkup(
      createElement(ResultIndicator, { status: 'paused', correctCount: 20, total: 20 }),
    )
    assert.ok(paused.includes('aria-label="Paused"'), paused)
  } finally {
    hooks.deregister()
  }
})
