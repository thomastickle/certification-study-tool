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
      <label className="theme-control">
        <span>Palette</span>
        <select
          value={palette}
          onChange={(event) => {
            const next = event.target.value as Palette
            onPaletteChange(next)
          }}
        >
          <option value="blue">Blue</option>
          <option value="forest">Forest</option>
          <option value="violet">Violet</option>
        </select>
      </label>
    </div>
  )
}
