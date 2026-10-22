type Props = {
  mode: 'quiz' | 'exam'
  disabled: boolean
  onChange: (mode: 'quiz' | 'exam') => void
  autoFocus: boolean
}

/** Presets select the existing attempt mode before a study session starts. */
export function PracticePresets({ mode, disabled, onChange, autoFocus }: Props) {
  return (
    <fieldset className="practice-presets" disabled={disabled}>
      <legend>Session preset</legend>
      <label>
        <input
          type="radio"
          name="practice-preset"
          value="quiz"
          checked={mode === 'quiz'}
          autoFocus={autoFocus && mode === 'quiz'}
          onChange={() => onChange('quiz')}
        />
        <span>
          Quiz <small>20 questions · 20 minutes</small>
        </span>
      </label>
      <label>
        <input
          type="radio"
          name="practice-preset"
          value="exam"
          checked={mode === 'exam'}
          autoFocus={autoFocus && mode === 'exam'}
          onChange={() => onChange('exam')}
        />
        <span>
          Exam <small>65 questions · 90 minutes</small>
        </span>
      </label>
    </fieldset>
  )
}
