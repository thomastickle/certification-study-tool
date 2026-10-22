export type ThemePreference = 'system' | 'light' | 'dark'

type ThemeStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

/** Invalid or unavailable storage leaves the desktop preference in control. */
export function readThemePreference(storage?: Pick<ThemeStorage, 'getItem'>): ThemePreference {
  try {
    const value = (storage ?? localStorage).getItem('study-theme')
    return value === 'light' || value === 'dark' ? value : 'system'
  } catch {
    return 'system'
  }
}

/** Storage is optional: a blocked write must not stop a session-only change. */
export function saveThemePreference(preference: ThemePreference, storage?: ThemeStorage) {
  try {
    const target = storage ?? localStorage
    if (preference === 'system') {
      target.removeItem('study-theme')
    } else {
      target.setItem('study-theme', preference)
    }
  } catch {
    // The selected appearance still applies to this page.
  }
}

export type Palette = 'blue' | 'forest' | 'violet'

/** Fall back to the original blue palette when storage is unavailable or invalid. */
export function readPalette(storage?: Pick<ThemeStorage, 'getItem'>): Palette {
  try {
    const value = (storage ?? localStorage).getItem('study-palette')
    return value === 'forest' || value === 'violet' ? value : 'blue'
  } catch {
    return 'blue'
  }
}

/** Remember the palette independently from light/dark appearance. */
export function savePalette(palette: Palette, storage?: ThemeStorage) {
  try {
    const target = storage ?? localStorage
    if (palette === 'blue') {
      target.removeItem('study-palette')
    } else {
      target.setItem('study-palette', palette)
    }
  } catch {
    // Palette changes still apply to this page when storage is blocked.
  }
}
