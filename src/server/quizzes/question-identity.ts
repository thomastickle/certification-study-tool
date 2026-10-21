import { certificationScope } from './certification-scope.ts'
import type { StoredQuiz } from './quiz-repository.ts'
import type { Question, Source } from '../../shared/contracts.ts'
import { answerKey, digest, fingerprint, matchText } from '../importer/bank-tools.ts'
import type { QuestionRecord } from '../questions/library-repository.ts'

/** Identify a library question without source-local provenance. */
export function currentQuestionIdentity(record: QuestionRecord, source: Source): string | null {
  const question = record.data
  if (!validQuestion(question) || !source.provider?.trim() || !source.certification?.trim()) {
    return null
  }
  return identity(question, source.provider, source.certification)
}

/** Compose importer semantics with the exact bank certification namespace. */
function identity(question: Question, provider: string, certification: string): string {
  return `mastery:v1:${digest([provider, certification, fingerprint(question), answerKey(question)])}`
}

/** Reject incomplete content and ambiguous normalized answer labels. */
function validQuestion(question: Question): boolean {
  if (
    typeof question?.question !== 'string' ||
    !matchText(question.question) ||
    !['single_select', 'multi_select'].includes(question.type) ||
    !Number.isInteger(question.select_count) ||
    question.select_count < 1 ||
    (question.type === 'single_select' && question.select_count !== 1) ||
    !Array.isArray(question.answers) ||
    question.answers.length < 2
  ) {
    return false
  }
  const texts = new Set<string>()
  for (const answer of question.answers) {
    if (typeof answer?.text !== 'string' || typeof answer.correct !== 'boolean') {
      return false
    }
    const text = matchText(answer.text)
    if (!text || texts.has(text)) {
      return false
    }
    texts.add(text)
  }
  return question.answers.filter((a) => a.correct).length === question.select_count
}

/** Resolve completed legacy evidence without consulting the library. */
export function completedQuestionIdentity(quiz: StoredQuiz, index: number): string | null {
  if (quiz.status !== 'completed' || !Number.isInteger(index) || index < 0) {
    return null
  }
  const saved = quiz.questions?.[index]
  if (!saved || !Array.isArray(saved.answers)) {
    return null
  }
  const ids = saved.answers.map((a) => a?.id)
  if (ids.some((id) => !Number.isSafeInteger(id) || id < 0) || new Set(ids).size !== ids.length) {
    return null
  }
  const publicKey = saved.correctAnswerIds
  const privateKey = quiz.keys?.[index]?.correct
  const evidence = [publicKey, privateKey].filter((key) => key !== undefined)
  if (
    evidence.length === 0 ||
    evidence.some(
      (key) =>
        !Array.isArray(key) ||
        key.length !== saved.selectCount ||
        new Set(key).size !== key.length ||
        key.some((id) => !ids.includes(id)),
    )
  ) {
    return null
  }
  const correct = evidence[0]!
  if (evidence.some((key) => key.some((id) => !correct.includes(id)))) {
    return null
  }
  const question: Question = {
    question: saved.question,
    type: saved.type,
    select_count: saved.selectCount,
    answers: saved.answers.map((a) => ({ text: a.text, correct: correct.includes(a.id) })),
  }
  if (!validQuestion(question)) {
    return null
  }
  // All app-created legacy snapshots belong to AWS CLF-C02; no library lookup is safe here.
  const scope = certificationScope(quiz.options)
  return identity(question, scope.provider, scope.certification)
}
