import { createContext, useContext } from 'react'

export type Theme = 'light' | 'dark'
export type ThemePref = Theme | 'system'

/** Shared with the pre-paint script in index.html — change both together. */
export const THEME_STORAGE_KEY = 'jojo.theme'

export type ThemeContextValue = {
  /** What the user chose. 'system' means follow the OS. */
  pref: ThemePref
  /** What is actually on screen right now. */
  theme: Theme
  setPref: (pref: ThemePref) => void
  toggle: () => void
}

export const ThemeContext = createContext<ThemeContextValue | null>(null)

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>')
  return ctx
}
