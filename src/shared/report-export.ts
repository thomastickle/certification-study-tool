import type { StudyReport } from './report-contracts.ts'

/** Formats an unmeasured percentage without implying a zero score. */
function percentage(value: number | null): string {
  return value === null ? 'No data' : `${Math.round(value)}%`
}

/** Escapes saved classification text so it cannot break Markdown tables. */
function cell(value: string): string {
  return value.replaceAll('|', '\\|').replaceAll(/\r?\n/g, ' ')
}

/** Creates a portable local report with explicit scoring denominators. */
export function studyReportMarkdown(report: StudyReport, scope: string): string {
  const lines = [
    `# ${report.certification} study report`,
    '',
    `Scope: ${scope}`,
    `Generated: ${new Date(report.generatedAt).toISOString()}`,
    '',
    `${report.counts.correct} correct, ${report.counts.incorrect} incorrect, ${report.counts.skipped} skipped`,
    `Score: ${percentage(report.counts.score)} (${report.counts.correct}/${report.counts.total} questions; skips count as misses)`,
    `Practice target met: ${report.passingAttempts}/${report.attempts.length} attempts (80% of all questions correct)`,
    '',
    'Completed attempts only. Repeat questions count each time. Correct-answer activity counts are not unique-question mastery. Raw practice scores are not official AWS scaled scores or readiness predictions.',
    '',
    '## Scoring details',
    '',
    `Accuracy on answered questions: ${percentage(report.counts.accuracy)} (${report.counts.answered} answered · ${report.counts.skipped} skipped)`,
    '',
    '## Domain details',
    '',
    '| Domain | Correct | Incorrect | Answered | Skipped | Score | Accuracy on answered questions |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...report.domains.map(
      (domain) =>
        `| ${domain.name} | ${domain.counts.correct} | ${domain.counts.incorrect} | ${domain.counts.answered} | ${domain.counts.skipped} | ${percentage(domain.counts.score)} | ${percentage(domain.counts.accuracy)} |`,
    ),
    '',
    '## Study areas and topics',
    '',
    '| Domain | Area · topic | Correct | Incorrect | Answered | Skipped | Score | Accuracy on answered questions |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...report.topics.map(
      (topic) =>
        `| ${topic.domain} | ${cell(topic.name)} | ${topic.counts.correct} | ${topic.counts.incorrect} | ${topic.counts.answered} | ${topic.counts.skipped} | ${percentage(topic.counts.score)} | ${percentage(topic.counts.accuracy)} |`,
    ),
    '',
    '## Daily score and activity (UTC)',
    '',
    '| Date | Correct | Total | Answered | Skipped | Score |',
    '| --- | ---: | ---: | ---: | ---: | ---: |',
    ...report.timeline.map(
      (day) =>
        `| ${day.date} | ${day.counts.correct} | ${day.counts.total} | ${day.counts.answered} | ${day.counts.skipped} | ${percentage(day.counts.score)} |`,
    ),
    '',
    '## Completed attempts',
    '',
    ...report.attempts.map(
      (attempt) =>
        `- ${new Date(attempt.finishedAt).toISOString()} · ${attempt.mode} · Score: ${attempt.counts.correct}/${attempt.counts.total} (${percentage(attempt.counts.score)}) · ${attempt.passed ? 'Target met' : 'Below target'} · ${attempt.id}`,
    ),
    '',
  ]
  return lines.join('\n')
}
