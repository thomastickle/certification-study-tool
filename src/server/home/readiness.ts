import type { Readiness } from '../../shared/home-contracts.ts'
import { readinessThresholds } from '../../shared/home-contracts.ts'
import { domainNames, examDomainQuotas } from '../quizzes/domain-mapping.ts'
import { completedEvidence, masteryHistory } from '../quizzes/mastery-history.ts'
import { studyDay } from '../quizzes/mastery.ts'
import type { StoredQuiz } from '../quizzes/quiz-repository.ts'
import { certificationScope, isClf, sameCertification } from '../quizzes/certification-scope.ts'
import type { CertificationScope } from '../quizzes/certification-scope.ts'

export const readinessPolicy = {
  days: 30,
  questionsPerDomain: 20,
  examDays: 3,
  newQuestionsPerExam: 13,
  ...readinessThresholds,
} as const

/** Unsupported exams never inherit another certification's performance or blueprint. */
export function emptyReadiness(supported: boolean): Readiness {
  return {
    status: supported ? 'insufficient' : 'unsupported',
    score: null,
    blendedScore: null,
    mastery: null,
    examAverage: null,
    exams: [],
    domains: [],
    reasons: [
      supported
        ? 'Build study evidence to assess readiness.'
        : 'Readiness assessment is not available for this certification yet.',
    ],
  }
}

/** Blend performance while preventing a high average from concealing a weak component. */
export function readinessScore(mastery: number, weakestDomain: number, exams: number[]) {
  const examAverage = exams.reduce((sum, score) => sum + score, 0) / exams.length
  const blendedScore = Math.floor(0.5 * examAverage + 0.25 * mastery + 0.25 * weakestDomain)
  const robust = Math.min(mastery, weakestDomain, ...exams) >= readinessPolicy.ready
  const score = robust ? blendedScore : Math.min(blendedScore, readinessPolicy.ready - 1)
  let status: Readiness['status'] = 'red'
  if (score >= readinessPolicy.ready) {
    status = 'green'
  } else if (score >= readinessPolicy.marginal) {
    status = 'yellow'
  }
  return { score, blendedScore, examAverage, status }
}

/** Assess scoped evidence; generic tracks use overall practice rather than an invented blueprint. */
export function certificationReadiness(
  completed: StoredQuiz[],
  now: number,
  scope: CertificationScope = {},
): Readiness {
  const selectedScope = certificationScope(scope)
  const blueprint = isClf(selectedScope)
  const names: readonly string[] = blueprint ? domainNames : ['All practice questions']
  const coverage = blueprint ? readinessPolicy.questionsPerDomain : 80

  const domainIndex = (question: StoredQuiz['questions'][number]) =>
    blueprint ? question.domain - 1 : 0

  const lifetime = completed.filter(
    (quiz) =>
      sameCertification(quiz.options, selectedScope) &&
      Number.isFinite(quiz.finishedAt) &&
      quiz.finishedAt! <= now,
  )
  const recent = lifetime.filter(
    (quiz) => quiz.finishedAt! >= now - readinessPolicy.days * 86400000,
  )
  const states = masteryHistory(lifetime).states
  const answered = new Set<string>()
  const domains = names.map((name) => ({
    name,
    answered: new Set<string>(),
    total: 0,
    correct: 0,
  }))
  const exams = new Map<string, { day: string; score: number; identities: Set<string> }>()
  const identityDomains = new Map<string, Set<number>>()
  for (const quiz of recent) {
    quiz.questions.forEach((question, index) => {
      const evidence = completedEvidence(quiz, index)
      if (!evidence) {
        return
      }
      const mapped = identityDomains.get(evidence.identity) ?? new Set<number>()
      mapped.add(domainIndex(question))
      identityDomains.set(evidence.identity, mapped)
    })
  }
  for (const quiz of recent) {
    const seen = new Set<string>()
    const quotaCounts = names.map(() => 0)
    let correct = 0
    let reliable = true
    quiz.questions.forEach((question, index) => {
      const evidence = completedEvidence(quiz, index)
      const domain = domains[domainIndex(question)]
      if (
        !evidence ||
        !domain ||
        identityDomains.get(evidence.identity)?.size !== 1 ||
        seen.has(evidence.identity)
      ) {
        reliable = false
        return
      }
      seen.add(evidence.identity)
      quotaCounts[domainIndex(question)]!++
      domain.total++
      if (evidence.correct) {
        domain.correct++
        correct++
      }
      if (evidence.answered) {
        answered.add(evidence.identity)
        domain.answered.add(evidence.identity)
      }
    })
    if (
      (quiz.mode ?? quiz.options.mode) !== 'exam' ||
      !reliable ||
      quiz.total !== 65 ||
      seen.size !== 65 ||
      quiz.correctCount !== correct ||
      (blueprint && !examDomainQuotas.every((quota, index) => quotaCounts[index] === quota)) ||
      quiz.pauseHistory?.complete !== true ||
      quiz.pauseHistory.intervals.length !== 0 ||
      quiz.deadline - quiz.startedAt !== 90 * 60_000
    ) {
      continue
    }
    const day = studyDay(quiz.finishedAt!)
    const score = (correct / 65) * 100
    const previous = exams.get(day)
    // A same-day retry cannot hide an earlier bad run or create another study day.
    if (!previous || score < previous.score) {
      exams.set(day, { day, score, identities: seen })
    }
  }
  const selected = [...exams.values()]
    .sort((a, b) => b.day.localeCompare(a.day))
    .slice(0, readinessPolicy.examDays)
  const result = emptyReadiness(true)
  result.basis = blueprint ? 'blueprint' : 'practice'
  result.mastery = answered.size
    ? ([...answered].filter((identity) => states.get(identity)?.mastered).length / answered.size) *
      100
    : null
  result.domains = domains.map((domain) => ({
    name: domain.name,
    distinctAnswered: domain.answered.size,
    score: domain.total ? (domain.correct / domain.total) * 100 : null,
  }))
  result.exams = selected.map(({ day, score }) => ({ day, score }))
  result.reasons = []
  for (const domain of result.domains) {
    if (domain.distinctAnswered < coverage) {
      result.reasons.push(
        `${domain.name}: ${domain.distinctAnswered}/${coverage} distinct questions answered in the last ${readinessPolicy.days} days.`,
      )
    }
  }
  if (selected.length < readinessPolicy.examDays) {
    result.reasons.push(
      `Complete uninterrupted 65-question exams on ${readinessPolicy.examDays} separate study days in the last ${readinessPolicy.days} days (${selected.length}/${readinessPolicy.examDays}).`,
    )
  }
  const previouslySeen = new Set<string>()
  for (const [index, exam] of [...selected].reverse().entries()) {
    const fresh = [...exam.identities].filter((identity) => !previouslySeen.has(identity)).length
    if (index > 0 && fresh < readinessPolicy.newQuestionsPerExam) {
      result.reasons.push(
        `The exam on ${exam.day} needs at least ${readinessPolicy.newQuestionsPerExam} questions not used in earlier assessed exams (${fresh} found).`,
      )
    }
    exam.identities.forEach((identity) => previouslySeen.add(identity))
  }
  if (result.reasons.length || result.mastery === null) {
    return result
  }
  const weakestDomain = Math.min(...result.domains.map((domain) => domain.score!))
  Object.assign(
    result,
    readinessScore(
      result.mastery,
      weakestDomain,
      selected.map((exam) => exam.score),
    ),
  )
  if (result.score !== result.blendedScore) {
    result.reasons.push(
      `Readiness stays below green until mastery, every domain, and each assessed exam reach ${readinessPolicy.ready}%.`,
    )
  }
  return result
}
