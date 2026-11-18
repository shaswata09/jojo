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
    // The filtering is the palette's own, with the shared matcher (below).
    expect(code).toMatch(/<Command\b[^>]*shouldFilter=\{false\}/)
  })
})

describe('the palette at scale (review 2: performance-2, health-4, web-a11y-7)', () => {
  it('filters its rows itself and caps each group, with a Show all row', () => {
    // cmdk filtered and re-appended every one of 2,373 items per keystroke.
    expect(code).toMatch(/const IDLE_ROWS = \d+/)
    expect(code).toMatch(/const GROUP_ROWS = 20\b/)
    expect(code).toMatch(/matched\.slice\(0, cap\)/)
    expect(code).toMatch(/<ShowAll\b/)
    expect(code).toContain("t('spotlight.showAll', { count })")
  })

  it('matches with the one word matcher the phone uses, accents folded', () => {
    expect(code).toMatch(/from '@jojo\/service\/core\/word-match'/)
    expect(code).not.toMatch(/function matchesQuery\(/)
  })

  it('points aria-activedescendant at the row Enter will open', () => {
    expect(code).toMatch(/useActiveDescendant\(root\)/)
    expect(code).toContain("setAttribute('aria-activedescendant', selected.id)")
  })
})

describe('a dialog opened from the palette (review 3: webui-3)', () => {
  it('records the palette’s trigger as its return target, not the palette’s vanished input', () => {
    expect(code).toMatch(
      /useLayoutEffect\(\(\) => \{\s*if \(!open\) return\s*const active = document\.activeElement/,
    )
    expect(code).toMatch(
      /if \(back\?\.isConnected\) back\.focus\(\{ preventScroll: true \}\)\s*next\(\)/,
    )
    expect(code).toMatch(/onSelect=\{\(\) => closeThen\(\(\) => runCreate\(action\)\)\}/)
    expect(code).toMatch(/onSelect=\{\(\) => closeThen\(\(\) => onPickTool\(row\)\)\}/)
    expect(code).not.toMatch(/requestAnimationFrame\(\(\) => (runCreate|onPickTool)\(/)
  })
})
