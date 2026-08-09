import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useColorScheme } from 'react-native'
import { PALETTES, type Palette, type ThemeName } from '@/theme/tokens'

export type ThemePref = ThemeName | 'system'

type ThemeContextValue = {
  /** What the user chose. 'system' means follow the OS. */
  pref: ThemePref
  /** What is actually on screen right now. */
  theme: ThemeName
  colors: Palette
  setPref: (pref: ThemePref) => void
  toggle: () => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

/**
 * Two themes, dark by default — the same contract as the web app's
 * `ThemeProvider`: follow the OS until the user says otherwise, then hold the
 * choice.
 *
 * Session-only, like every other preference in this prototype. The web version
 * persists to localStorage and resolves the theme before first paint with an
 * inline script; there is no equivalent flash to avoid here, because the root
 * view is painted from these tokens rather than by the document.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme()
  const [pref, setPref] = useState<ThemePref>('system')

  const theme: ThemeName = pref === 'system' ? (system === 'light' ? 'light' : 'dark') : pref

  const toggle = useCallback(
    () => setPref(theme === 'dark' ? 'light' : 'dark'),
    [theme],
  )

  const value = useMemo(
    () => ({ pref, theme, colors: PALETTES[theme], setPref, toggle }),
    [pref, theme, toggle],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>')
  return ctx
}

/** The palette on its own — what almost every component actually wants. */
export function useColors() {
  return useTheme().colors
}
