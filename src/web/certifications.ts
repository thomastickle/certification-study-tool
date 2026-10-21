import type { Source } from '../shared/contracts.ts'

export type Certification = {
  provider: string
  code: string
  name: string
  organization: string
  platform: string
  level: string | null
  aliases: string[]
}

type CertificationDetails = Pick<Certification, 'organization' | 'platform' | 'level'>

const amazonCodes: Record<string, string> = {
  'CLF-C02': 'Foundational',
  'DEA-C01': 'Associate',
  'SAA-C03': 'Associate',
  'DVA-C02': 'Associate',
  'SOA-C02': 'Associate',
  'DOP-C02': 'Professional',
  'SAP-C02': 'Professional',
  'ANS-C01': 'Specialty',
  'SCS-C02': 'Specialty',
}

const azureCodes: Record<string, string> = {
  'AZ-900': 'Fundamentals',
  'DP-900': 'Fundamentals',
  'AI-900': 'Fundamentals',
  'SC-900': 'Fundamentals',
  'MS-900': 'Fundamentals',
}

const microsoftPlatformPrefixes: Array<[string, string]> = [
  ['MS-', 'Microsoft 365'],
  ['PL-', 'Power Platform'],
  ['MB-', 'Dynamics 365'],
]

/** Normalizes display and search metadata without changing backend identity. */
function normalizeProvider(provider: string): {
  provider: string
  aliases: string[]
  platform: string
} {
  const normalized = provider.trim()
  const lower = normalized.toLowerCase()

  if (['aws', 'amazon', 'amazon web services'].includes(lower)) {
    return {
      provider: 'Amazon Web Services',
      aliases: ['AWS', 'Amazon', 'Amazon Web Services'],
      platform: 'AWS',
    }
  }

  if (['azure', 'microsoft', 'ms'].includes(lower)) {
    return { provider: 'Microsoft', aliases: ['Azure', 'Microsoft', 'MS'], platform: 'Azure' }
  }

  if (['gcp', 'google cloud', 'google cloud platform'].includes(lower)) {
    return {
      provider: 'Google Cloud',
      aliases: ['GCP', 'Google Cloud', 'Google Cloud Platform'],
      platform: 'Google Cloud',
    }
  }

  const microsoftPlatform = /^(microsoft)\s+(365|power platform|dynamics 365)/i.exec(normalized)
  if (microsoftPlatform) {
    const platform = microsoftPlatform[2]!.replace(/^365$/, 'Microsoft 365')
    return { provider: 'Microsoft', aliases: ['Microsoft', platform], platform }
  }

  return { provider: normalized, aliases: normalized ? [normalized] : [], platform: normalized }
}

/** Derives optional catalog metadata from the imported certification. */
function detailsFor(provider: string, code: string, name: string): CertificationDetails {
  const upperCode = code.trim().toUpperCase()
  const identity = normalizeProvider(provider)
  if (identity.provider === 'Amazon Web Services') {
    return {
      organization: identity.provider,
      platform: identity.platform,
      level: amazonCodes[upperCode] ?? null,
    }
  }

  if (identity.provider === 'Google Cloud') {
    const level = upperCode === 'CDL' || /cloud digital leader/i.test(name) ? 'Foundational' : null
    return { organization: identity.provider, platform: identity.platform, level }
  }

  if (identity.provider === 'Microsoft') {
    let platform = identity.platform
    let level = azureCodes[upperCode] ?? null
    if (/^(AZ|DP|AI|SC)-/.test(upperCode)) {
      platform = 'Azure'
    }
    if (/^(MS|PL|MB)-/.test(upperCode)) {
      const prefix = microsoftPlatformPrefixes.find(([candidate]) =>
        upperCode.startsWith(candidate),
      )
      if (prefix) {
        platform = prefix[1]
      }
      if (upperCode.endsWith('-900')) {
        level = 'Fundamentals'
      }
    }
    return { organization: 'Microsoft', platform, level }
  }

  return { organization: identity.provider, platform: identity.platform, level: null }
}

/** Returns the stable identity used to deduplicate a certification. */
export function certificationKey(cert: Pick<Certification, 'provider' | 'code'>): string {
  return JSON.stringify([cert.provider, cert.code])
}

/** Builds a unique catalog from eligible imported question sources. */
export function certificationsFromSources(sources: Source[]): Certification[] {
  const certifications = new Map<string, Certification>()

  for (const source of sources) {
    if (source.questionCount <= 0 || !['official', 'third_party'].includes(source.kind)) {
      continue
    }
    const identity = normalizeProvider(source.provider)
    const code = source.certification
    const key = certificationKey({ provider: source.provider, code })
    if (!code.trim() || certifications.has(key)) {
      continue
    }

    certifications.set(key, {
      provider: source.provider,
      code,
      name: source.certificationName,
      ...detailsFor(source.provider, code, source.certificationName),
      aliases: [...new Set([...identity.aliases, source.provider, source.certification])],
    })
  }

  return [...certifications.values()].sort((left, right) =>
    `${left.organization} ${left.platform} ${left.name} ${left.code}`.localeCompare(
      `${right.organization} ${right.platform} ${right.name} ${right.code}`,
    ),
  )
}

/** Filters certifications where every query token occurs in the searchable metadata. */
export function filterCertifications(certs: Certification[], query: string): Certification[] {
  const tokens = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean)
  if (!tokens.length) {
    return certs
  }

  return certs.filter((cert) => {
    const metadata = [
      cert.provider,
      cert.code,
      cert.name,
      cert.organization,
      cert.platform,
      cert.level ?? '',
      ...cert.aliases,
    ]
      .join(' ')
      .toLocaleLowerCase()
    return tokens.every((token) => metadata.includes(token))
  })
}
