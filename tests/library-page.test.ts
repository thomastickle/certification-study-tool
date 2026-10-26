import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderWorkspace as renderToStaticMarkup } from './render-workspace.ts'
import ts from 'typescript'
import type { Source } from '../src/shared/contracts.ts'

test('library renders page content without duplicating the application header', async () => {
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
    const { LibraryPage, LibraryView } = await import('../src/web/features/library/LibraryPage.tsx')
    const html = renderToStaticMarkup(createElement(LibraryPage, { canManage: true }))
    assert.equal((html.match(/<header\b/g) ?? []).length, 0, 'the app shell owns the shared header')
    assert.equal((html.match(/<main\b/g) ?? []).length, 1)
    assert.match(html, /<h1>Question library<\/h1>/)
    assert.match(html, /Import a bank/)
    assert.match(html, /Search questions/)
    assert.doesNotMatch(html, /A place to build your knowledge/)
    const student = renderToStaticMarkup(createElement(LibraryPage, { canManage: false }))
    assert.match(student, /Question library/)
    assert.match(student, /Import a bank/)
    assert.match(student, /My private library/)
    const sharedStudent = renderToStaticMarkup(
      createElement(LibraryView, {
        canManage: false,
        visibility: 'shared',
        onVisibilityChange: () => {},
      }),
    )
    assert.doesNotMatch(
      sharedStudent,
      /Import a bank|Create concept group|Delete source|Delete question/,
    )
    assert.match(sharedStudent, /Administrators manage shared content/)
    const sharedAdmin = renderToStaticMarkup(
      createElement(LibraryView, {
        canManage: true,
        visibility: 'shared',
        onVisibilityChange: () => {},
      }),
    )
    assert.match(sharedAdmin, /Import a bank/)
  } finally {
    hooks.deregister()
  }
})

test('quiz bank picker renders individual checked banks, source groups, counts and bulk controls', async () => {
  const hooks = registerHooks({
    load(url, context, nextLoad) {
      if (!url.startsWith('file:') || !url.endsWith('.tsx')) return nextLoad(url, context)
      return {
        format: 'module',
        shortCircuit: true,
        source: ts.transpileModule(readFileSync(fileURLToPath(url), 'utf8'), {
          compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext },
        }).outputText,
      }
    },
  })
  try {
    const { QuizSourcePicker } = await import('../src/web/features/practice/QuizSourcePicker.tsx')
    const base = { provider: 'AWS', certification: 'CLF-C02', certificationName: 'Synthetic exam' }
    const sources: Source[] = [
      {
        ...base,
        id: 1,
        key: 'official',
        name: 'Official sample',
        kind: 'official',
        questionCount: 65,
      },
      {
        ...base,
        id: 2,
        key: 'third',
        name: 'Third-party sample',
        kind: 'third_party',
        questionCount: 41,
      },
    ]
    const html = renderToStaticMarkup(
      createElement(QuizSourcePicker, {
        sources,
        selected: [2],
        onChange: () => {},
      }),
    )
    assert.equal((html.match(/type="checkbox"/g) ?? []).length, 2)
    assert.equal((html.match(/ checked=""/g) ?? []).length, 1)
    assert.match(html, /Official sample/)
    assert.match(html, /Third-party sample/)
    assert.match(html, /65 questions/)
    assert.match(html, /41 questions/)
    assert.match(html, /Select all/)
    assert.match(html, />Clear</)
    assert.match(html, /aria-haspopup="dialog"/)
    const trigger = html.slice(html.indexOf('<button'), html.indexOf('</button>'))
    assert.match(trigger, /Third-party · 1 bank · 41 questions/)
    assert.doesNotMatch(trigger, /Official/)
    const grouped = renderToStaticMarkup(
      createElement(QuizSourcePicker, {
        sources: [...sources, { ...sources[1]!, id: 3, questionCount: 19 }],
        selected: [1, 2, 3],
        onChange: () => {},
      }),
    )
    const groupedTrigger = grouped.slice(grouped.indexOf('<button'), grouped.indexOf('</button>'))
    assert.match(groupedTrigger, /Official · 1 bank · 65 questions/)
    assert.match(groupedTrigger, /Third-party · 2 banks · 60 questions/)
    const empty = renderToStaticMarkup(
      createElement(QuizSourcePicker, { sources, selected: [], onChange: () => {} }),
    )
    assert.match(
      empty.slice(empty.indexOf('<button'), empty.indexOf('</button>')),
      /Choose question banks/,
    )
    assert.match(html, /aria-expanded="false"/)
    assert.match(html, /<dialog\b/)
    assert.doesNotMatch(html, /<dialog[^>]*\sopen(?:=|\s|>)/)
    const { QuizPage } = await import('../src/web/features/practice/QuizPage.tsx')
    const setup = renderToStaticMarkup(
      createElement(QuizPage, {
        certification: {
          provider: 'AWS',
          code: 'CLF-C02',
          name: 'Cloud Practitioner',
          organization: 'Amazon Web Services',
          platform: 'AWS',
          level: 'Foundational',
          aliases: ['Amazon'],
        },
        onRegisterLeave: () => {},
      }),
    )
    assert.doesNotMatch(setup, /Question format|<select\b/)
  } finally {
    hooks.deregister()
  }
})
