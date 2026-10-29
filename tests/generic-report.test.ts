import { prepareManagedDatabase } from './managed-database-fixture.ts'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'
import { LibraryRepository } from '../src/server/questions/library-repository.ts'
import type { StoredQuiz } from '../src/server/quizzes/quiz-repository.ts'
import { ReportService } from '../src/server/reports/report-service.ts'
import { studyReportMarkdown } from '../src/shared/report-export.ts'
import type { StudyReport } from '../src/shared/report-contracts.ts'

/** Two completed attempts meet the old focus gate without any configured domain mapping. */
function genericReport(provider = 'Azure', certification = 'AZ-900'): StudyReport {
  const repository = new LibraryRepository(prepareManagedDatabase())
  const now = Date.UTC(2026, 9, 20)
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const questions: StoredQuiz['questions'] = Array.from({ length: 10 }, (_, i) => ({
        questionId: i,
        question: `Synthetic generic question ${i}`,
        type: 'single_select',
        selectCount: 1,
        answers: [
          { id: 0, text: 'Correct' },
          { id: 1, text: 'Wrong' },
        ],
        selected: [0],
        correct: true,
        correctAnswerIds: [0],
        confidence: 'Confident',
        flagged: false,
        domain: 0,
        area: null,
        topic: null,
        sourceName: 'Synthetic generic bank',
        sourceKind: 'third_party',
        reference: `generic-${i}`,
      }))
      repository.quizStore().save({
        id: `generic-${attempt}`,
        status: 'completed',
        startedAt: now - 60000,
        finishedAt: now - attempt * 1000,
        deadline: now + 60000,
        serverNow: now,
        total: 10,
        correctCount: 10,
        options: { provider, certification, sourceFilter: 'mixed', questionType: 'mixed' },
        questions,
        keys: questions.map(() => ({ fingerprint: 'synthetic', correct: [0] })),
      })
    }
    return new ReportService(repository, () => now).get({ provider, certification })
  } finally {
    repository.close()
  }
}

test('generic report never ranks an unmapped domain after qualifying practice', () => {
  const report = genericReport()
  assert.equal(report.attempts.length, 2)
  assert.equal(report.unique.answered, 10)
  assert.equal(report.counts.total, 20)
  assert.equal(report.counts.correct, 20)
  assert.equal(report.topics[0]!.name, 'Unclassified · Unclassified')
  assert.equal(report.topics[0]!.counts.total, 20)
  assert.equal(report.focus.domain, null)
  assert.deepEqual(report.focus.domains, [])
})

test('generic Markdown explains missing mapping instead of recommending Domain 0 or more practice', () => {
  for (const report of [
    genericReport(),
    genericReport('Other', 'CLF-C02'),
    { ...genericReport('AWS', 'SAA-C03'), provider: undefined },
  ]) {
    const text = studyReportMarkdown(report, 'All practice · All time')
    assert.match(text, /Domain mapping not configured/)
    assert.match(text, /Unclassified · Unclassified/)
    assert.match(text, /20 correct, 0 incorrect, 0 skipped/)
    assert.doesNotMatch(
      text,
      /Focus: Domain|Insufficient evidence|every supported domain|ranked by score|## Domain details|\| Domain \|/i,
    )
  }
})

test('aggregate dashboard omits generic domain coverage and ranking while preserving legacy CLF', async () => {
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
    const { ReportDashboard } = await import('../src/web/features/reports/ReportDashboard.tsx')
    for (const report of [
      genericReport(),
      genericReport('Other', 'CLF-C02'),
      { ...genericReport('AWS', 'SAA-C03'), provider: undefined },
    ]) {
      const html = renderToStaticMarkup(
        createElement(ReportDashboard, { report, onOpenAttempt: () => {} }),
      )
      assert.match(html, /Domain mapping not configured/)
      assert.match(html, /Unclassified · Unclassified/)
      assert.match(html, /2 completed/)
      assert.doesNotMatch(
        html,
        /Domains explored|\/ 4 domains|Domain 0|Insufficient evidence|Each supported domain|Ranking uses score|A clearer view of every domain/,
      )
    }
    const repository = new LibraryRepository(prepareManagedDatabase())
    try {
      const legacy = new ReportService(repository).get()
      delete legacy.provider
      const html = renderToStaticMarkup(
        createElement(ReportDashboard, { report: legacy, onOpenAttempt: () => {} }),
      )
      assert.match(html, /Domains explored/)
      assert.match(html, /\/ 4 domains/)
      assert.match(html, /Insufficient evidence/)
      assert.match(html, /Cloud Concepts/)
      assert.doesNotMatch(html, /Domain mapping not configured/)
      assert.match(studyReportMarkdown(legacy, 'All time'), /Insufficient evidence/)
    } finally {
      repository.close()
    }
  } finally {
    hooks.deregister()
  }
})
