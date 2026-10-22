import { useEffect, useState } from 'react'
import { readPalette, readThemePreference, savePalette, saveThemePreference } from './theme.ts'
import type { Palette, ThemePreference } from './theme.ts'

/** Keep preferences active across destinations, including session-only storage fallbacks. */
export function useAppearance() {
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

  /** Apply an explicit appearance choice without requiring storage to be available. */
  function onPreferenceChange(next: ThemePreference) {
    setPreference(next)
    saveThemePreference(next)
  }

  /** Remember the palette independently from the light/dark setting. */
  function onPaletteChange(next: Palette) {
    setPalette(next)
    savePalette(next)
  }

  return { preference, palette, onPreferenceChange, onPaletteChange }
}
