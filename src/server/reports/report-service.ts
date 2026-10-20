import type { QuizQuestion } from '../../shared/quiz-contracts.ts'
import type { StudyReport, ReportCounts, ReportBreakdown } from '../../shared/report-contracts.ts'
import { ApplicationError } from '../errors.ts'
import { domainNames } from '../quizzes/domain-mapping.ts'
import type { LibraryRepository } from '../questions/library-repository.ts'

/** Null percentages distinguish no evidence from a measured zero. */
function counts(questions: QuizQuestion[]): ReportCounts {
  const total = questions.length
  const answered = questions.filter((q) => q.selected.length > 0).length
  const correct = questions.filter((q) => q.correct === true).length
  return {
    total,
    answered,
    correct,
    incorrect: answered - correct,
    skipped: total - answered,
    accuracy: answered ? (correct / answered) * 100 : null,
    score: total ? (correct / total) * 100 : null,
  }
}

/** Groups saved classifications without guessing missing study areas or topics. */
function topics(questions: QuizQuestion[]): ReportBreakdown[] {
  const groups = new Map<string, { name: string; domain: number; questions: QuizQuestion[] }>()
  for (const question of questions) {
    const name = `${question.area ?? 'Unclassified'} · ${question.topic ?? 'Unclassified'}`
    const id = JSON.stringify([question.domain, question.area, question.topic])
    if (!groups.has(id)) {
      groups.set(id, { name, domain: question.domain, questions: [] })
    }
    groups.get(id)!.questions.push(question)
  }
  return [...groups]
    .map(([id, group]) => ({
      id,
      name: group.name,
      domain: group.domain,
      counts: counts(group.questions),
    }))
    .sort((a, b) => a.domain - b.domain || a.name.localeCompare(b.name))
}

type ReportInput = { mode?: string | null; days?: string | null; certification?: string | null }

/** Reports read saved snapshots, so source deletions cannot rewrite study history. */
export class ReportService {
  private repository: LibraryRepository
  private now: () => number

  constructor(repository: LibraryRepository, now = Date.now) {
    this.repository = repository
    this.now = now
  }

  /**
   * Returns completed-attempt evidence without answer keys or library mutations.
   * @throws {ApplicationError} When a certification, mode or time range is unsupported.
   */
  get(input: ReportInput = {}): StudyReport {
    const mode = input.mode ?? 'all'
    const days = input.days ?? 'all'
    if (
      !['all', 'quiz', 'exam'].includes(mode) ||
      !['all', '7', '30', '90'].includes(days) ||
      (input.certification != null && input.certification !== 'CLF-C02')
    ) {
      throw new ApplicationError(
        'Choose CLF-C02, a valid practice mode, and an available time range.',
      )
    }
    const now = this.now()
    const since = days === 'all' ? -Infinity : now - Number(days) * 86400000
    const completed = this.repository
      .quizStore()
      .completed()
      .filter(
        (quiz) =>
          (mode === 'all' || (quiz.mode ?? quiz.options.mode ?? 'quiz') === mode) &&
          quiz.finishedAt! >= since &&
          quiz.finishedAt! <= now,
      )
      .sort((a, b) => b.finishedAt! - a.finishedAt! || b.id.localeCompare(a.id))
    const questions = completed.flatMap((quiz) => quiz.questions)
    const attempts = completed.map((quiz) => ({
      id: quiz.id,
      mode: quiz.mode ?? quiz.options.mode ?? 'quiz',
      startedAt: quiz.startedAt,
      finishedAt: quiz.finishedAt!,
      counts: counts(quiz.questions),
      passed: quiz.correctCount! / quiz.total >= 0.8,
      durationMs: Math.max(0, quiz.finishedAt! - quiz.startedAt),
    }))
    const daily = new Map<string, { questions: QuizQuestion[]; attempts: number }>()
    for (const quiz of completed) {
      const date = new Date(quiz.finishedAt!).toISOString().slice(0, 10)
      const day = daily.get(date) ?? { questions: [], attempts: 0 }
      day.questions.push(...quiz.questions)
      day.attempts++
      daily.set(date, day)
    }
    return {
      certification: 'CLF-C02',
      generatedAt: now,
      counts: counts(questions),
      passingAttempts: attempts.filter((a) => a.passed).length,
      attempts,
      domains: domainNames.map((name, i) => ({
        id: String(i + 1),
        name,
        domain: i + 1,
        counts: counts(questions.filter((q) => q.domain === i + 1)),
      })),
      topics: topics(questions),
      confidence: ['Confident', 'Educated Guess', 'Unsure', 'Not recorded'].map((name) => ({
        name,
        counts: counts(questions.filter((q) => (q.confidence ?? 'Not recorded') === name)),
      })),
      timeline: [...daily]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, day]) => ({
          date,
          counts: counts(day.questions),
          attempts: day.attempts,
        })),
    }
  }
}
