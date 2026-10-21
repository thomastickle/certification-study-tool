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
      [0, 20, 'Below 70%'],
      [6999, 10000, 'Below 70%'],
      [70, 100, '70–90%'],
      [90, 100, '70–90%'],
      [9001, 10000, 'Above 90%'],
      [20, 20, 'Above 90%'],
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
