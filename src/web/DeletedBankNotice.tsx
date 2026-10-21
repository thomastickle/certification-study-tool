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
