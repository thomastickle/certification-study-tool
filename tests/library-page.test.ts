import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'

test('importer renders page content without duplicating the application header', async () => {
  // Node strips TS but not TSX; compile JSX using the project's existing compiler.
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
    const { LibraryPage } = await import('../src/web/LibraryPage.tsx')
    const html = renderToStaticMarkup(createElement(LibraryPage))
    assert.equal((html.match(/<header\b/g) ?? []).length, 0, 'the app shell owns the shared header')
    assert.equal((html.match(/<main\b/g) ?? []).length, 1)
    assert.match(html, /<h1>Question library<\/h1>/)
    assert.match(html, /Import a bank/)
    assert.match(html, /Search questions/)
    assert.doesNotMatch(html, /A place to build your knowledge/)
  } finally {
    hooks.deregister()
  }
})
