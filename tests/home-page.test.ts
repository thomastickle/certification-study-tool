import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'
import type { HomeSummary } from '../src/shared/home-contracts.ts'

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

test('home dashboard groups real tracks and explains readiness without exposing answer data', async () => {
  try {
    const { HomeDashboard } = await import('../src/web/features/home/HomeDashboard.tsx')
    const summary: HomeSummary = {
      generatedAt: 1,
      providers: [
        {
          name: 'AWS',
          total: 2,
          ready: 1,
          dueCount: 3,
          certifications: [
            {
              provider: 'AWS',
              code: 'CLF-C02',
              name: 'Cloud Practitioner',
              sourceIds: [1],
              earned: true,
              dueCount: 3,
              readiness: {
                basis: 'practice',
                status: 'green',
                score: 96,
                blendedScore: 96,
                mastery: 97,
                examAverage: 95,
                exams: [{ day: '2026-10-01', score: 95 }],
                domains: [{ name: 'Cloud concepts', distinctAnswered: 2, score: 96 }],
                reasons: ['Recent exam average is strong'],
              },
            },
            {
              provider: 'AWS',
              code: 'SAA-C03',
              name: 'Solutions Architect Associate',
              sourceIds: [2],
              earned: false,
              dueCount: 0,
              readiness: {
                status: 'insufficient',
                score: null,
                blendedScore: null,
                mastery: null,
                examAverage: null,
                exams: [],
                domains: [],
                reasons: ['Answer more distinct questions'],
              },
            },
          ],
        },
      ],
    }
    const html = renderToStaticMarkup(
      createElement(HomeDashboard, {
        summary,
        onNavigate: () => {},
        onPractice: () => {},
        onReview: () => {},
      }),
    )
    assert.match(html, /1 \/ 2 tracks ready/)
    assert.equal((html.match(/class="provider-card"/g) ?? []).length, 1)
    assert.match(html, /aria-label="AWS tracks ready"/)
    assert.match(html, /Mastery: 97%/)
    assert.match(html, /Assessed exam average: 95%/)
    assert.match(html, /Green also requires 90% in every component/)
    assert.doesNotMatch(html, /Green also requires 95%/)
    assert.match(html, /Cloud Practitioner/)
    assert.match(html, /CLF-C02/)
    assert.match(html, /96%/)
    assert.match(html, /Strong practice/)
    assert.match(html, /Practice estimate/)
    assert.match(html, /Needs more data/)
    assert.match(html, /aria-label="Earned certification"/)
    assert.match(html, /Recent exam average is strong/)
    assert.match(html, /Cloud concepts/)
    assert.doesNotMatch(html, /type="checkbox"/)
    assert.doesNotMatch(html, /session-option|Practice session/)
    assert.doesNotMatch(html, /distinctAnswered|sourceIds|2026-10-01/)
  } finally {
    hooks.deregister()
  }
})

test('home dashboard renders unsupported readiness neutrally without a score', async () => {
  try {
    const { HomeDashboard } = await import('../src/web/features/home/HomeDashboard.tsx')
    const html = renderToStaticMarkup(
      createElement(HomeDashboard, {
        summary: {
          generatedAt: 1,
          providers: [
            {
              name: 'Other',
              total: 1,
              ready: 0,
              dueCount: 0,
              certifications: [
                {
                  provider: 'Other',
                  code: 'EX-1',
                  name: 'Example',
                  sourceIds: [],
                  earned: false,
                  dueCount: 0,
                  readiness: {
                    status: 'unsupported',
                    score: null,
                    blendedScore: null,
                    mastery: null,
                    examAverage: null,
                    exams: [],
                    domains: [],
                    reasons: ['Readiness is not available for this track'],
                  },
                },
              ],
            },
          ],
        } satisfies HomeSummary,
        onNavigate: () => {},
        onPractice: () => {},
        onReview: () => {},
      }),
    )
    assert.match(html, /Not yet supported/)
    assert.match(html, /readiness-neutral/)
    assert.doesNotMatch(html, />0%/)
  } finally {
    hooks.deregister()
  }
})
