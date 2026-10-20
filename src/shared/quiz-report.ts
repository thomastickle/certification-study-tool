import { formatDuration, quizTiming, timingSummary } from './quiz-timing.ts'
import type { QuizView } from './quiz-contracts.ts'

/** Local plain Markdown suitable for download/copy; no network or bank mutation. */
export function quizReport(quiz: QuizView): string {
  if (quiz.status !== 'completed' || quiz.correctCount === null)
    throw new Error('Submit and score the quiz before exporting its report.')
  const mode = quiz.mode ?? quiz.options.mode ?? 'quiz'
  let title = mode === 'exam' ? 'Exam' : 'Quiz'
  if (mode === 'review') {
    title = 'Due Review'
  }
  const answered = quiz.questions.filter((q) => q.selected.length > 0).length
  const accuracy = answered ? `${((quiz.correctCount / answered) * 100).toFixed(0)}%` : 'No data'
  const percent = quiz.total ? (quiz.correctCount / quiz.total) * 100 : null
  const score = percent === null ? 'No data' : `${percent.toFixed(0)}%`
  let result = 'No data'
  if (percent !== null) {
    result = percent >= 80 ? 'Pass' : 'Fail'
  }
  const timing = quizTiming(quiz)
  const lines = [
    `# CLF-C02 practice ${mode} report`,
    '',
    `${title}: ${quiz.id}`,
    `Started: ${new Date(quiz.startedAt).toISOString()}`,
    `Finished: ${new Date(quiz.finishedAt!).toISOString()}`,
    timingSummary(timing),
    'Durations: HH:MM:SS, rounded down to whole seconds.',
    ...timing.pauses.map(
      (pause, index) =>
        `Pause ${index + 1}: ${pause.cause ?? 'Cause not recorded'} · ${new Date(pause.startedAt).toISOString()} → ${pause.endedAt === null ? 'Ongoing' : new Date(pause.endedAt).toISOString()} · ${formatDuration(pause.durationMs)}`,
    ),
    mode === 'review'
      ? 'Due Review · no quiz/exam pass target. Only correct + Confident passes a due retention check.'
      : `Result: ${result} — ${quiz.correctCount}/${quiz.total} (${score}). Practice target: 80%.`,
    `Score: ${score} (${quiz.correctCount}/${quiz.total} questions; skips count as misses)`,
    'Practice targets are study aids, not official AWS scaled scores or exam-readiness predictions.',
    '',
    '## Scoring details',
    '',
    `Accuracy on answered questions: ${accuracy} (${answered} answered · ${quiz.total - answered} skipped)`,
    '',
    'Please help me understand my answers, especially incorrect answers and answers I was not confident about. Source answer keys are study material, not an independent guarantee of correctness.',
    '',
  ]
  for (const [index, question] of quiz.questions.entries()) {
    const letters = (ids: number[]) =>
      ids.length ? ids.map((id) => String.fromCharCode(65 + id)).join(', ') : 'None'

    lines.push(
      `## Question ${index + 1} — ${question.correct ? 'Correct' : 'Incorrect'}`,
      '',
      question.question,
      '',
      `Selection: ${question.type === 'multi_select' ? 'Multiple answers' : 'Single answer'}; choose ${question.selectCount}.`,
      ...question.answers.map((answer) => `${String.fromCharCode(65 + answer.id)}. ${answer.text}`),
      '',
      `My answer: ${letters(question.selected)}`,
      `Correct answer: ${letters(question.correctAnswerIds ?? [])}`,
      `Confidence: ${question.confidence ?? 'Not recorded'}`,
      `Marked for review: ${question.flagged ? 'Yes' : 'No'}`,
      `Source: ${question.sourceName} (${question.sourceKind}); reference: ${question.reference}`,
      ...(question.concepts?.length
        ? [`Reviewed concepts: ${question.concepts.map((concept) => concept.name).join('; ')}`]
        : []),
      ...(question.variationNote ? [question.variationNote] : []),
      `Exam domain: ${question.domain}; study area: ${question.area ?? 'Unclassified'}; topic: ${question.topic ?? 'Unclassified'}`,
      '',
    )
  }
  return lines.join('\n')
}
