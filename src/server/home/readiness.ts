import type { Readiness } from '../../shared/home-contracts.ts'

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
