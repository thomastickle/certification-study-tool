import type { Palette, ThemePreference } from './theme.ts'

export type ThemeControlProps = {
  preference: ThemePreference
  palette: Palette
  onPreferenceChange: (preference: ThemePreference) => void
  onPaletteChange: (palette: Palette) => void
}

/** Present browser-local appearance options using workspace-owned preference state. */
export function ThemeControl({
  preference,
  palette,
  onPreferenceChange,
  onPaletteChange,
}: ThemeControlProps) {
  return (
    <div className="appearance-controls">
      <label className="theme-control">
        <span>Theme</span>
        <select
          value={preference}
          onChange={(event) => {
            const next = event.target.value as ThemePreference
            onPreferenceChange(next)
          }}
        >
          <option value="system">System</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </label>
      <fieldset className="palette-picker">
        <legend>Palette</legend>
        <div className="palette-options">
          {(['blue', 'forest', 'violet'] as const).map((value) => (
            <label key={value} className="palette-option">
              <input
                type="radio"
                name="palette"
                value={value}
                checked={palette === value}
                onChange={() => onPaletteChange(value)}
              />
              <span className="palette-preview" data-palette={value} aria-hidden="true">
                <span className="palette-check">✓</span>
              </span>
              <span className="palette-name">{value.charAt(0).toUpperCase() + value.slice(1)}</span>
            </label>
          ))}
        </div>
      </fieldset>
    </div>
  )
}
