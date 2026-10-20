import type { StudyReport } from './report-contracts.ts'

/** Formats unmeasured accuracy without implying a zero score. */
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
    `Answer accuracy: ${percentage(report.counts.accuracy)} (${report.counts.answered} answered)`,
    `Raw score including skipped questions: ${percentage(report.counts.score)}`,
    `Practice target met: ${report.passingAttempts}/${report.attempts.length} attempts (80% of all questions correct)`,
    '',
    'Completed attempts only. Repeat questions count each time. Raw practice scores are not official AWS scaled scores or readiness predictions.',
    '',
    '## Domains',
    '',
    '| Domain | Correct | Incorrect | Skipped | Accuracy |',
    '| --- | ---: | ---: | ---: | ---: |',
    ...report.domains.map(
      (domain) =>
        `| ${domain.name} | ${domain.counts.correct} | ${domain.counts.incorrect} | ${domain.counts.skipped} | ${percentage(domain.counts.accuracy)} |`,
    ),
    '',
    '## Study areas and topics',
    '',
    '| Domain | Area · topic | Correct | Incorrect | Skipped | Accuracy |',
    '| --- | --- | ---: | ---: | ---: | ---: |',
    ...report.topics.map(
      (topic) =>
        `| ${topic.domain} | ${cell(topic.name)} | ${topic.counts.correct} | ${topic.counts.incorrect} | ${topic.counts.skipped} | ${percentage(topic.counts.accuracy)} |`,
    ),
    '',
    '## Daily progress (UTC)',
    '',
    '| Date | Correct | Answered | Skipped | Accuracy |',
    '| --- | ---: | ---: | ---: | ---: |',
    ...report.timeline.map(
      (day) =>
        `| ${day.date} | ${day.counts.correct} | ${day.counts.answered} | ${day.counts.skipped} | ${percentage(day.counts.accuracy)} |`,
    ),
    '',
    '## Completed attempts',
    '',
    ...report.attempts.map(
      (attempt) =>
        `- ${new Date(attempt.finishedAt).toISOString()} · ${attempt.mode} · ${attempt.counts.correct}/${attempt.counts.total} (${percentage(attempt.counts.score)}) · ${attempt.passed ? 'Target met' : 'Below target'} · ${attempt.id}`,
    ),
    '',
  ]
  return lines.join('\n')
}
