import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'
import type { QuizView } from '../src/shared/quiz-contracts.ts'

const quiz: QuizView = {
  id: 'timing-example',
  status: 'completed',
  startedAt: 1000,
  deadline: 2000000,
  finishedAt: 1336000,
  serverNow: 1336000,
  correctCount: 0,
  total: 0,
  questions: [],
  options: { sourceFilter: 'mixed', questionType: 'mixed' },
}

/** Loads the actual React component without introducing a browser-only test dependency. */
async function renderTiming(view: QuizView): Promise<string> {
  const hooks = registerHooks({
    load(url, context, nextLoad) {
      if (!url.startsWith('file:') || !url.endsWith('.tsx')) {
        return nextLoad(url, context)
      }
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
    const { AttemptTiming } = await import('../src/web/AttemptTiming.tsx')
    return renderToStaticMarkup(createElement(AttemptTiming, { quiz: view }))
  } finally {
    hooks.deregister()
  }
}

test('timing presents four compact labeled metrics, excluding pauses from time in test', async () => {
  const html = await renderTiming({
    ...quiz,
    pauseHistory: {
      complete: true,
      intervals: [
        { startedAt: 10000, endedAt: 70000, cause: 'manual' },
        { startedAt: 100000, endedAt: 253000, cause: 'navigation' },
      ],
    },
  })
  for (const [label, value] of [
    ['Total time', '22m 15s'],
    ['Time in test', '18m 42s'],
    ['Pauses', '2'],
    ['Pause time', '3m 33s'],
  ]) {
    assert.ok(html.includes(`<dt>${label}</dt><dd>${value}</dd>`), `Missing ${label}: ${value}`)
  }
  assert.doesNotMatch(html, /<h2|Active study|Earlier pause history|HH:MM:SS|<ol/)
})

test('legacy timing uses dashes for unknown metrics, preserving measured total time', async () => {
  const html = await renderTiming(quiz)
  assert.ok(html.includes('<dt>Total time</dt><dd>22m 15s</dd>'))
  assert.equal((html.match(/<dd>—<\/dd>/g) ?? []).length, 3)
  assert.doesNotMatch(html, /not recorded|unknown|Earlier pause/i)
})

test('known zero pauses and hour-long sessions remain readable and truthful', async () => {
  const html = await renderTiming({
    ...quiz,
    finishedAt: quiz.startedAt + 3661000,
    pauseHistory: { complete: true, intervals: [] },
  })
  assert.ok(html.includes('<dt>Total time</dt><dd>1h 1m 1s</dd>'))
  assert.ok(html.includes('<dt>Time in test</dt><dd>1h 1m 1s</dd>'))
  assert.ok(html.includes('<dt>Pauses</dt><dd>0</dd>'))
  assert.ok(html.includes('<dt>Pause time</dt><dd>0s</dd>'))
})
