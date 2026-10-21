import type { StudyReport } from '../shared/report-contracts.ts'

/** Identify historical source deletion without suggesting that the result was deleted. */
export function DeletedBankNotice({
  names,
  compact = false,
}: {
  names?: string[]
  compact?: boolean
}) {
  if (!names?.length) {
    return null
  }
  const label = `Question bank deleted: ${names.join(', ')}`
  if (compact) {
    return (
      <span
        className="deleted-bank-badge"
        title={`${label}. Original saved questions retained after reimport.`}
      >
        Question bank deleted
      </span>
    )
  }
  return (
    <p className="deleted-bank-notice">
      <strong>{label}.</strong> This attempt uses the original saved questions and answers. Its
      score still counts after reimport.
    </p>
  )
}

/** Keep lifetime evidence visible even when the current report filter has no attempts. */
export function DeletedBankLifetimeNotice({ report }: { report: StudyReport }) {
  if ((report.deletedBankLifetimeAttemptCount ?? 0) <= (report.deletedBankAttemptCount ?? 0)) {
    return null
  }
  return (
    <p className="deleted-bank-notice">
      Lifetime mastery includes {report.deletedBankLifetimeAttemptCount}{' '}
      {report.deletedBankLifetimeAttemptCount === 1 ? 'attempt that used' : 'attempts that used'}{' '}
      deleted question banks, including attempts outside these filters.
    </p>
  )
}
