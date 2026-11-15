import type { ThemePref } from '@/theme/theme-context'
import type { ThemeName } from '@/theme/tokens'

/**
 * The theme a fresh session starts in: dark, unless the person switches.
 *
 * See `theme.tsx` for why this is `'dark'` and not `'system'`. Kept as a
 * constant beside `resolveTheme` so the rule can be asserted without mounting
 * `ThemeProvider` (D20).
 */
export const DEFAULT_THEME_PREF: ThemePref = 'dark'

/**
 * What is on screen for a preference. `'system'` follows the OS, and an OS that
 * reports nothing (or anything but light) gets dark.
 */
export function resolveTheme(pref: ThemePref, system: string | null | undefined): ThemeName {
  return pref === 'system' ? (system === 'light' ? 'light' : 'dark') : pref
}
