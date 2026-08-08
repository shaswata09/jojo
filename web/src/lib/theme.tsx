import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { readStored, removeStored, writeStored } from '@/lib/storage'
import { THEME_STORAGE_KEY, ThemeContext, type Theme, type ThemePref } from '@/lib/theme-context'

const DARK_QUERY = '(prefers-color-scheme: dark)'

function readPref(): ThemePref {
  const stored = readStored(THEME_STORAGE_KEY)
  return stored === 'light' || stored === 'dark' ? stored : 'system'
}

function systemTheme(): Theme {
  return window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light'
}

/**
 * Writes both `data-theme` (drives jojo's token values) and the `dark` class
 * (drives shadcn's `dark:` variant). Keeping them in one place is what stops
 * third-party registry components from theming out of sync with the app.
 */
function applyTheme(theme: Theme) {
  const root = document.documentElement
  root.dataset.theme = theme
  root.classList.toggle('dark', theme === 'dark')
  root.style.colorScheme = theme
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Read storage once on mount rather than on every render path.
  const [pref, setPrefState] = useState<ThemePref>(readPref)
  const [resolved, setResolved] = useState<Theme>(() => {
    const initial = readPref()
    return initial === 'system' ? systemTheme() : initial
  })

  // Re-resolve when the preference changes, and follow the OS while on 'system'.
  useEffect(() => {
    if (pref !== 'system') {
      setResolved(pref)
      return
    }
    const mq = window.matchMedia(DARK_QUERY)
    const sync = () => setResolved(mq.matches ? 'dark' : 'light')
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [pref])

  useEffect(() => applyTheme(resolved), [resolved])

  const setPref = useCallback((next: ThemePref) => {
    setPrefState(next)
    // Storage may be unavailable; the theme still applies for this session.
    if (next === 'system') removeStored(THEME_STORAGE_KEY)
    else writeStored(THEME_STORAGE_KEY, next)
  }, [])

  // Toggling picks the opposite of what's on screen, which drops out of
  // 'system' — matching the mockup's "use the toggle to override".
  const toggle = useCallback(
    () => setPref(resolved === 'dark' ? 'light' : 'dark'),
    [resolved, setPref],
  )

  const value = useMemo(
    () => ({ pref, theme: resolved, setPref, toggle }),
    [pref, resolved, setPref, toggle],
  )

  return <ThemeContext value={value}>{children}</ThemeContext>
}
