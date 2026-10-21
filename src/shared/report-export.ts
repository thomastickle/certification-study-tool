import { timingSummary } from './quiz-timing.ts'
import type { StudyReport } from './report-contracts.ts'

/** Formats an unmeasured percentage without implying a zero score. */
function percentage(value: number | null): string {
  return value === null ? 'No data' : `${Math.round(value)}%`
}

/** Escapes saved classification text so it cannot break Markdown tables. */
function cell(value: string): string {
  return value.replaceAll('|', '\\|').replaceAll(/\r?\n/g, ' ')
}

/** Review scores are activity evidence without an exam pass target. */
function attemptResult(passed: boolean | null): string {
  if (passed === null) {
    return 'Due Review · no pass target'
  }
  return passed ? 'Target met' : 'Below target'
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
    `Practice target met: ${report.passingAttempts}/${report.targetAttempts} quiz/exam attempts (80% of all questions correct)`,
    '',
    'Completed attempts only. Repeat questions count each time. Correct-answer activity counts are not unique-question mastery. Raw practice scores are not official certification scores or readiness predictions.',
    '',
    '## Unique-question coverage and lifetime mastery',
    '',
    `Unique questions encountered in this filter: ${report.unique.encountered}; answered: ${report.unique.answered}.`,
    `Lifetime mastery for those questions: ${report.unique.mastered} mastered (${report.unique.firstEncounter} on first encounter; ${report.unique.afterPractice} after practice). Lifetime status uses all completed evidence, including outside these filters.`,
    `Unknown identity: ${report.unique.unknownIdentityAppearances} appearances; unknown mastery evidence: ${report.unique.unknownMasteryEvidenceAppearances} appearances. Unknown evidence supplies no mastery credit.`,
    '',
    '## Focus recommendation evidence',
    '',
    report.focus.domain === null
      ? 'Insufficient evidence: every supported domain needs at least 10 distinct answered questions across 2 completed attempts.'
      : `Focus: Domain ${report.focus.domain}, ranked by score (correct / all appearances, including skips).`,
    'Starting product heuristic, not a statistical confidence or exam-readiness guarantee.',
    '| Domain | Distinct answered (10 needed) | Completed attempts (2 needed) | Answered appearances | Total appearances | Score |',
    '| --- | ---: | ---: | ---: | ---: | ---: |',
    ...report.focus.domains.map(
      (d) =>
        `| ${d.domain} | ${d.distinctAnswered} | ${d.completedAttempts} | ${d.answeredAppearances} | ${d.totalAppearances} | ${percentage(d.score)} |`,
    ),
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
    'Durations: HH:MM:SS, rounded down to whole seconds. Active study excludes pauses; elapsed includes pauses. Missing history is not recorded.',
    '',
    ...report.attempts.map(
      (attempt) =>
        `- ${new Date(attempt.finishedAt).toISOString()} · ${attempt.mode} · Score: ${attempt.counts.correct}/${attempt.counts.total} (${percentage(attempt.counts.score)}) · ${attemptResult(attempt.passed)} · ${timingSummary(attempt.timing)} · ${attempt.id}`,
    ),
    '',
  ]
  return lines.join('\n')
}
