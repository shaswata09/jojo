import { createContext, useContext } from 'react'
import type { Palette, ThemeName } from '@/theme/tokens'

export type ThemePref = ThemeName | 'system'

export type ThemeContextValue = {
  /** What the user chose. 'system' means follow the OS. */
  pref: ThemePref
  /** What is actually on screen right now. */
  theme: ThemeName
  colors: Palette
  setPref: (pref: ThemePref) => void
  toggle: () => void
}

export const ThemeContext = createContext<ThemeContextValue | null>(null)

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>')
  return ctx
}

/** The palette on its own — what almost every component actually wants. */
export function useColors() {
  return useTheme().colors
}
