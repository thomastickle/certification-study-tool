import type { Question } from '../../shared/contracts.ts'

export const domainNames = [
  'Cloud Concepts',
  'Security and Compliance',
  'Cloud Technology and Services',
  'Billing, Pricing, and Support',
] as const

// Largest-remainder rounding of AWS's 24/30/34/12 weights for 20 questions.
export const domainQuotas = [5, 6, 7, 2] as const

// Largest-remainder rounding of the same weights for 65 questions.
export const examDomainQuotas = [16, 19, 22, 8] as const

/** Selection metadata only: never rewrite bank classifications or claim AWS verification. */
export function examDomain(question: Question): number | null {
  const metadata = question.source_metadata
  if (metadata && typeof metadata === 'object' && 'domain_id' in metadata) {
    const id = Number(metadata.domain_id)
    if (Number.isInteger(id) && id >= 1 && id <= 4) return id
  }
  const { area, topic } = question.classification ?? {}
  const direct: Record<string, number> = {
    'Cloud Concepts': 1,
    'Security & Compliance': 2,
    'Cloud Technology & Services': 3,
    'Billing, Pricing & Support': 4,
    'Identity & security': 2,
    'Billing & support': 4,
    'AI & ML': 3,
    'Application & deployment': 3,
    'Application integration': 3,
    'Databases & analytics': 3,
    Networking: 3,
    Storage: 3,
  }
  if (area && direct[area]) return direct[area]!
  if (area === 'Cloud fundamentals')
    return [
      'AWS global infrastructure',
      'Regions & Availability Zones',
      'Global reach & content delivery',
    ].includes(topic ?? '')
      ? 3
      : 1
  if (area === 'Compute') return topic === 'EC2 purchasing options' ? 4 : 3
  if (area === 'Management & governance') {
    if (['AWS Cloud Adoption Framework', 'AWS Well-Architected Framework'].includes(topic ?? ''))
      return 1
    if (topic === 'Trusted Advisor checks') return 4
    if (topic === 'Multi-account governance (AWS Control Tower)') return 2
  }
  if (area === 'Migration & hybrid') {
    if (['Migration strategies', 'Migration assessment'].includes(topic ?? '')) return 1
    if (topic === 'AWS Partner Network') return 4
    if (
      [
        'Database migration (AWS DMS)',
        'Hybrid storage (Storage Gateway)',
        'Server migration (AWS MGN)',
      ].includes(topic ?? '')
    )
      return 3
  }
  if (area === 'Observability & operations') {
    if (
      [
        'API activity auditing (AWS CloudTrail)',
        'Resource configuration & AWS Config',
        'Secure instance access (Session Manager)',
      ].includes(topic ?? '')
    )
      return 2
    if (
      ['Metrics & monitoring (CloudWatch)', 'Log analytics (CloudWatch Logs Insights)'].includes(
        topic ?? '',
      )
    )
      return 3
  }
  return null
}
