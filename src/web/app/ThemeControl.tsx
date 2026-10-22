import { useEffect, useState } from 'react'
import { readPalette, readThemePreference, savePalette, saveThemePreference } from './theme.ts'
import type { Palette, ThemePreference } from './theme.ts'

/** Keep appearance local to this browser, with a way back to the desktop setting. */
export function ThemeControl() {
  const [preference, setPreference] = useState(readThemePreference)

  const [palette, setPalette] = useState(readPalette)

  useEffect(() => {
    document.documentElement.dataset.palette = palette
  }, [palette])

  useEffect(() => {
    document.documentElement.dataset.theme = preference
  }, [preference])

  useEffect(() => {
    /** Reflect preference changes made in another tab on the same origin. */
    function syncPreference(event: StorageEvent) {
      if (event.key === 'study-palette' || event.key === null) {
        setPalette(readPalette())
      }
      if (event.key === 'study-theme' || event.key === null) {
        setPreference(readThemePreference())
      }
    }

    window.addEventListener('storage', syncPreference)
    return () => window.removeEventListener('storage', syncPreference)
  }, [])

  return (
    <div className="appearance-controls">
      <label className="theme-control">
        <span>Theme</span>
        <select
          value={preference}
          onChange={(event) => {
            const next = event.target.value as ThemePreference
            setPreference(next)
            saveThemePreference(next)
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
            setPalette(next)
            savePalette(next)
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
