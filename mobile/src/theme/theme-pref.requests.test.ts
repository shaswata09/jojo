/**
 * Q070 — the phone app opens dark unless the person switches.
 *
 * The owner's words (2026-08-09): "dark should be default theme unless user
 * changes to light." Following the OS was the earlier default and shipped a
 * light app to nearly everyone, because most phones sit on light.
 *
 * D20: `ThemeProvider` is not mounted. The rule is `DEFAULT_THEME_PREF` plus
 * `resolveTheme`, and one narrow source read pins that the provider still
 * starts from that constant rather than from a literal or from the OS.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { DEFAULT_THEME_PREF, resolveTheme } from './theme-pref'

const HERE = path.dirname(fileURLToPath(import.meta.url))

describe('the theme a fresh session starts in', () => {
  it('is dark on a phone whose OS is set to light', () => {
    // The case that matters: following the OS here would be light.
    expect(resolveTheme(DEFAULT_THEME_PREF, 'light')).toBe('dark')
  })

  it('is dark whatever the OS reports, including nothing', () => {
    for (const system of ['dark', 'light', null, undefined]) {
      expect(resolveTheme(DEFAULT_THEME_PREF, system)).toBe('dark')
    }
  })

  it('is what ThemeProvider seeds its state with', () => {
    const source = readFileSync(path.join(HERE, 'theme.tsx'), 'utf8')
    expect(source).toContain('useState<ThemePref>(DEFAULT_THEME_PREF)')
  })
})

describe('switching away from the default', () => {
  it('keeps light once the person picks light, even on a dark OS', () => {
    expect(resolveTheme('light', 'dark')).toBe('light')
  })

  it('hands the choice to the OS only when the person picks system', () => {
    expect(resolveTheme('system', 'light')).toBe('light')
    expect(resolveTheme('system', 'dark')).toBe('dark')
  })
})
