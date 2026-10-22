import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'
import { LibraryRepository } from '../src/server/questions/library-repository.ts'
import { LibraryService } from '../src/server/questions/library-service.ts'
import { QuizService } from '../src/server/quizzes/quiz-service.ts'
import { HomeService } from '../src/server/home/home-service.ts'
import { ReportService } from '../src/server/reports/report-service.ts'
import { populate } from './quiz-fixtures.ts'

test('Home, Reports and individual reviews visibly explain retained evidence from deleted banks', async () => {
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
  const repository = new LibraryRepository(':memory:')
  try {
    const { HomeDashboard } = await import('../src/web/features/home/HomeDashboard.tsx')
    const { ReportDashboard } = await import('../src/web/features/reports/ReportDashboard.tsx')
    const { ReportAttemptReview } =
      await import('../src/web/features/reports/ReportAttemptReview.tsx')
    populate(repository)
    const now = Date.parse('2026-10-21T12:00:00Z')
    const quizzes = new QuizService(repository, () => now)
    const quiz = quizzes.start({ sourceFilter: 'mixed', questionType: 'mixed' })
    quizzes.submit(quiz.id, { answers: quiz.questions })
    const reports = new ReportService(repository, () => now)

    const renderReport = () =>
      renderToStaticMarkup(
        createElement(ReportDashboard, {
          report: reports.get(),
          onOpenAttempt: () => {},
        }),
      )

    assert.doesNotMatch(renderReport(), /Question bank deleted|uses deleted question banks/)
    new LibraryService(repository).deleteSource(repository.sources()[0]!.id)
    const reportHtml = renderReport()
    assert.match(reportHtml, /1 attempt in this view uses deleted question banks/)
    assert.match(reportHtml, /Contains obsolete \/ deleted questions/)
    assert.match(reportHtml, /title="Question bank deleted: quiz-synthetic/)
    const homeHtml = renderToStaticMarkup(
      createElement(HomeDashboard, {
        summary: new HomeService(repository, () => now).get(),
        onNavigate: () => {},
        onPractice: () => {},
        onReview: () => {},
      }),
    )
    assert.match(homeHtml, /1 saved attempt uses deleted question banks/)
    const detailHtml = renderToStaticMarkup(
      createElement(ReportAttemptReview, { quiz: quizzes.get(quiz.id) }),
    )
    assert.match(detailHtml, /Question bank deleted/)
    assert.match(detailHtml, /quiz-synthetic/)
    assert.match(detailHtml, /score still counts/)
    const filteredHtml = renderToStaticMarkup(
      createElement(ReportDashboard, {
        report: reports.get({ mode: 'exam' }),
        onOpenAttempt: () => {},
      }),
    )
    assert.match(
      filteredHtml,
      /Lifetime mastery includes 1 attempt that used deleted question banks/,
    )
    assert.doesNotMatch(filteredHtml, /1 attempt in this view/)
  } finally {
    repository.close()
    hooks.deregister()
  }
})
