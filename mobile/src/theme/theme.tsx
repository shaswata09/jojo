import { useCallback, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useColorScheme } from 'react-native'
import { ThemeContext } from '@/theme/theme-context'
import type { ThemePref } from '@/theme/theme-context'
import { PALETTES, type ThemeName } from '@/theme/tokens'

/**
 * Two themes, and the app opens dark.
 *
 * The default is `'dark'` rather than `'system'` deliberately. Following the OS
 * sounds more polite, but it means the app's own identity is decided by a
 * setting that has nothing to do with it — and in practice most devices sit on
 * light, so "follow the system" shipped a light app to nearly everyone. Dark is
 * what this design was drawn for: the palettes in `tokens.ts` were tuned dark
 * first, and the accent and stage colours were picked against the dark ground.
 *
 * `'system'` is still on offer in Settings, it is just no longer the starting
 * point. Choosing light — or handing the decision back to the OS — is one tap,
 * and the choice then holds for the session.
 *
 * The context and its hooks live in `theme-context.ts`, which is the split the
 * web app makes for the same reason: a file that exports both a provider and a
 * hook cannot be hot-reloaded without remounting everything under it.
 *
 * Session-only, like every other preference in this prototype. The web version
 * persists to localStorage and resolves the theme before first paint with an
 * inline script; there is no equivalent flash to avoid here, because the root
 * view is painted from these tokens rather than by the document.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme()
  const [pref, setPref] = useState<ThemePref>('dark')

  const theme: ThemeName = pref === 'system' ? (system === 'light' ? 'light' : 'dark') : pref

  const toggle = useCallback(() => setPref(theme === 'dark' ? 'light' : 'dark'), [theme])

  const value = useMemo(
    () => ({ pref, theme, colors: PALETTES[theme], setPref, toggle }),
    [pref, theme, toggle],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}
