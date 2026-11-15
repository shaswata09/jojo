import { describe, expect, it } from 'vitest'
import spotlightSearch from '@/components/layout/SpotlightSearch.tsx?raw'
import topbar from '@/components/layout/Topbar.tsx?raw'

/**
 * Q025 — search opens a centred, wide, Spotlight-style overlay with the
 * filtered results listed under the input. Source reads (D20).
 */
const strip = (src: string) =>
  src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')

const code = strip(spotlightSearch)

/** The overlay's own class string. */
const overlay = /<CommandDialog[\s\S]*?className="([^"]*)"/.exec(code)?.[1] ?? ''

describe('the search overlay (Q025)', () => {
  it('is a dialog over the page, opened from the topbar', () => {
    expect(code).toMatch(/<CommandDialog\b/)
    expect(strip(topbar)).toMatch(/<SpotlightSearch open=\{spotlight\.open\}/)
  })

  it('is wide: up to 44rem, and nearly the whole screen on a phone', () => {
    expect(overlay).toMatch(/\bw-\[min\(92vw,44rem\)\]/)
    // The dialog's own sm:max-w-md would otherwise cap it at 28rem.
    expect(overlay).toMatch(/\bsm:max-w-none\b/)
  })

  it('sits high and centred, the way Spotlight does', () => {
    expect(overlay).toMatch(/\btop-\[15%\]/)
  })

  it('lists the filtered results below the input', () => {
    const input = code.indexOf('<CommandInput')
    const list = code.indexOf('<CommandList')
    expect(input).toBeGreaterThan(-1)
    expect(list).toBeGreaterThan(input)
    expect(code).toMatch(/<Command\b[^>]*filter=\{matchesQuery\}/)
  })
})
