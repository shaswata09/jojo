import { describe, expect, it } from 'vitest'
import { themePrefOf } from '@/lib/theme-context'
import indexHtml from '../../index.html?raw'

/**
 * Q166 — the web app starts in the dark theme on first load.
 *
 * Two places decide it and both have to: `themePrefOf` for the React tree, and
 * the pre-paint script in index.html, which runs before any of it and is what
 * stops a light flash.
 */
describe('the theme a first load gets (Q166)', () => {
  it('is dark when nothing has been chosen', () => {
    expect(themePrefOf(null)).toBe('dark')
  })

  it('is dark when what is stored is not a theme', () => {
    expect(themePrefOf('')).toBe('dark')
    expect(themePrefOf('auto')).toBe('dark')
  })

  it('still honours a choice that was made', () => {
    expect(themePrefOf('light')).toBe('light')
    expect(themePrefOf('system')).toBe('system')
    expect(themePrefOf('dark')).toBe('dark')
  })

  it('is painted dark by index.html before the app runs', () => {
    expect(indexHtml).toMatch(/<html lang="en" data-theme="dark" class="dark">/)
    // The pre-paint resolver's last fallback, for no stored choice.
    expect(indexHtml).toMatch(/:\s*'light'\s*:\s*'dark'\s*var root/)
  })
})
