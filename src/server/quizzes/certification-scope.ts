import type { QuizOptions } from '../../shared/quiz-contracts.ts'
import { ApplicationError } from '../errors.ts'

export type CertificationScope = Pick<QuizOptions, 'provider' | 'certification'>

/** Resolve legacy snapshots and omitted request fields to the original certification. */
export function certificationScope(input: CertificationScope = {}) {
  const provider = input.provider ?? 'AWS'
  const certification = input.certification ?? 'CLF-C02'
  if (
    typeof provider !== 'string' ||
    !provider.trim() ||
    typeof certification !== 'string' ||
    !certification.trim()
  ) {
    throw new ApplicationError('Choose a non-empty provider and certification.')
  }
  return { provider, certification }
}

/** Compare the full pair so identical codes at different providers stay separate. */
export function sameCertification(a: CertificationScope, b: CertificationScope): boolean {
  const left = certificationScope(a)
  const right = certificationScope(b)
  return left.provider === right.provider && left.certification === right.certification
}

/** Only the original AWS certification has app-defined domain mappings and quotas. */
export function isClf(scope: CertificationScope): boolean {
  return sameCertification(scope, {})
}
