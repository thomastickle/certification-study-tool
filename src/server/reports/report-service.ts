import { certificationScope, sameCertification, isClf } from '../quizzes/certification-scope.ts'
import { completedQuestionIdentity } from '../quizzes/question-identity.ts'
import { completedEvidence, masteryHistory } from '../quizzes/mastery-history.ts'
import { quizTiming } from '../../shared/quiz-timing.ts'
import type { QuizQuestion } from '../../shared/quiz-contracts.ts'
import type { StudyReport, ReportCounts, ReportBreakdown } from '../../shared/report-contracts.ts'
import { ApplicationError } from '../http/errors.ts'
import { domainNames } from '../quizzes/domain-mapping.ts'
import type { StudyRepository } from '../questions/study-library.ts'

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

type ReportInput = {
  mode?: string | null
  days?: string | null
  certification?: string | null
  provider?: string | null
}

/** Reports read saved snapshots, so source deletions cannot rewrite study history. */
export class ReportService {
  private repository: StudyRepository
  private now: () => number

  constructor(repository: StudyRepository, now = Date.now) {
    this.repository = repository
    this.now = now
  }

  /**
   * Returns completed-attempt evidence without answer keys or library mutations.
   * @throws {ApplicationError} When scope fields are empty or the mode or time range is unsupported.
   */
  get(input: ReportInput = {}): StudyReport {
    const scope = certificationScope({
      provider: input.provider ?? undefined,
      certification: input.certification ?? undefined,
    })
    const mode = input.mode ?? 'all'
    const days = input.days ?? 'all'
    if (
      !['all', 'quiz', 'exam', 'review'].includes(mode) ||
      !['all', '7', '30', '90'].includes(days)
    ) {
      throw new ApplicationError('Choose a valid practice mode and an available time range.')
    }
    const now = this.now()
    const since = days === 'all' ? -Infinity : now - Number(days) * 86400000
    const lifetime = this.repository
      .quizStore()
      .completed()
      .filter((quiz) => sameCertification(quiz.options, scope))
      .filter((quiz) => !Number.isFinite(quiz.finishedAt) || quiz.finishedAt! <= now)
    const completed = lifetime
      .filter(
        (quiz) =>
          Number.isFinite(quiz.finishedAt) &&
          (mode === 'all' || (quiz.mode ?? quiz.options.mode ?? 'quiz') === mode) &&
          quiz.finishedAt! >= since &&
          quiz.finishedAt! <= now,
      )
      .sort((a, b) => b.finishedAt! - a.finishedAt! || b.id.localeCompare(a.id))
    const questions = completed.flatMap((quiz) => quiz.questions)
    const attempts = completed.map((quiz) => ({
      deletedBankNames: quiz.deletedBankNames ?? [],
      id: quiz.id,
      mode: quiz.mode ?? quiz.options.mode ?? 'quiz',
      startedAt: quiz.startedAt,
      finishedAt: quiz.finishedAt!,
      counts: counts(quiz.questions),
      passed:
        (quiz.mode ?? quiz.options.mode) === 'review'
          ? null
          : quiz.correctCount! / quiz.total >= 0.8,
      timing: quizTiming(quiz),
      durationMs: Math.max(0, quiz.finishedAt! - quiz.startedAt),
    }))
    const identities = new Set<string>()
    const answered = new Set<string>()
    let unknownIdentityAppearances = 0
    let unknownMasteryEvidenceAppearances = 0
    for (const quiz of completed) {
      quiz.questions.forEach((question, index) => {
        const identity = completedQuestionIdentity(quiz, index)
        if (identity) {
          identities.add(identity)
          if (question.selected.length) {
            answered.add(identity)
          }
        } else {
          unknownIdentityAppearances++
        }
        if (!completedEvidence(quiz, index)) {
          unknownMasteryEvidenceAppearances++
        }
      })
    }
    const states = masteryHistory(lifetime).states
    const mastered = [...identities].flatMap((identity) => {
      const state = states.get(identity)
      return state?.mastered ? [state] : []
    })
    const domains = isClf(scope)
      ? domainNames.map((name, index) => ({ domain: index + 1, name }))
      : [...new Set(questions.map((q) => q.domain))]
          .sort((a, b) => a - b)
          .map((domain) => ({ domain, name: 'Unclassified' }))
    const evidence = (isClf(scope) ? domains : []).map(({ domain }) => {
      const distinct = new Set<string>()
      const attempts = new Set<string>()
      for (const quiz of completed) {
        quiz.questions.forEach((q, i) => {
          const identity = completedQuestionIdentity(quiz, i)
          if (q.domain === domain && q.selected.length && identity) {
            distinct.add(identity)
            attempts.add(quiz.id)
          }
        })
      }
      const activity = counts(questions.filter((q) => q.domain === domain))
      return {
        domain,
        distinctAnswered: distinct.size,
        completedAttempts: attempts.size,
        answeredAppearances: activity.answered,
        totalAppearances: activity.total,
        score: activity.score,
        qualified: distinct.size >= 10 && attempts.size >= 2,
      }
    })
    const weakest =
      evidence.length > 0 && evidence.every((domain) => domain.qualified)
        ? [...evidence].sort((a, b) => a.score! - b.score! || a.domain - b.domain)[0]!.domain
        : null
    const daily = new Map<string, { questions: QuizQuestion[]; attempts: number }>()
    for (const quiz of completed) {
      const date = new Date(quiz.finishedAt!).toISOString().slice(0, 10)
      const day = daily.get(date) ?? { questions: [], attempts: 0 }
      day.questions.push(...quiz.questions)
      day.attempts++
      daily.set(date, day)
    }
    return {
      deletedBankAttemptCount: completed.filter((quiz) => quiz.deletedBankNames?.length).length,
      deletedBankLifetimeAttemptCount: lifetime.filter((quiz) => quiz.deletedBankNames?.length)
        .length,
      unique: {
        encountered: identities.size,
        answered: answered.size,
        mastered: mastered.length,
        firstEncounter: mastered.filter((s) => s.masteryOrigin === 'first').length,
        afterPractice: mastered.filter((s) => s.masteryOrigin === 'practice').length,
        unknownIdentityAppearances,
        unknownMasteryEvidenceAppearances,
      },
      focus: { domain: weakest, metric: 'score', domains: evidence },
      targetAttempts: attempts.filter((a) => a.passed !== null).length,
      ...scope,
      generatedAt: now,
      counts: counts(questions),
      passingAttempts: attempts.filter((a) => a.passed).length,
      attempts,
      domains: domains.map(({ name, domain }) => ({
        id: String(domain),
        name,
        domain,
        counts: counts(questions.filter((q) => q.domain === domain)),
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
