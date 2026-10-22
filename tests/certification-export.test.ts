import assert from 'node:assert/strict'
import { test } from 'node:test'
import { quizReport } from '../src/shared/quiz-report.ts'
import type { QuizView } from '../src/shared/quiz-contracts.ts'
import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'

test('attempt exports identify the saved certification rather than the active workspace', () => {
  const view: QuizView = {
    id: 'synthetic-export',
    status: 'completed',
    startedAt: 1000,
    deadline: 2000,
    finishedAt: 1500,
    correctCount: 0,
    total: 0,
    serverNow: 1500,
    questions: [],
    options: {
      sourceFilter: 'mixed',
      questionType: 'mixed',
      provider: 'Azure',
      certification: 'AZ-900',
    },
  }
  const text = quizReport(view)
  assert.match(text, /^# AZ-900 practice quiz report/)
  assert.doesNotMatch(text, /CLF-C02|AWS/)
  const legacy = { ...view, options: { sourceFilter: 'mixed', questionType: 'mixed' } } as QuizView
  assert.match(quizReport(legacy), /^# CLF-C02 practice quiz report/)
})

test('attempt detail does not label another certification with CLF-C02 exam domains', async () => {
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
    const { ReportAttemptReview } =
      await import('../src/web/features/reports/ReportAttemptReview.tsx')
    const quiz: QuizView = {
      id: 'synthetic-view',
      status: 'completed',
      startedAt: 1000,
      deadline: 2000,
      finishedAt: 1500,
      correctCount: 0,
      total: 0,
      serverNow: 1500,
      questions: [],
      options: {
        sourceFilter: 'mixed',
        questionType: 'mixed',
        provider: 'Azure',
        certification: 'AZ-900',
      },
    }
    const html = renderToStaticMarkup(createElement(ReportAttemptReview, { quiz }))
    assert.match(html, /AZ-900/)
    assert.doesNotMatch(
      html,
      /Billing, Pricing|Cloud Technology and Services|Security and Compliance/,
    )
    assert.match(html, /Domain not mapped/)
  } finally {
    hooks.deregister()
  }
})
