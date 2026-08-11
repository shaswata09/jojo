import { describe, expect, it } from 'vitest'
import indexCss from '@/index.css?raw'
import keywordChipSource from './KeywordChip.tsx?raw'
import pageHeaderSource from './PageHeader.tsx?raw'
import toneSwatchesSource from './ToneSwatches.tsx?raw'

/**
 * Controls that a finger has to hit, checked against the rule that grows them.
 *
 * The touch tier in `index.css` reaches icon controls by matching the drawn
 * size in the class attribute — `size-6`, `size-7`, `size-8` — and everything
 * else opts in with `.touch-target`. Two controls fell through the gap and one
 * was documented as though it had not:
 *
 *   - the keyword chip's chevron, named in the stylesheet's own comment as the
 *     example of a control too small for any size class, measured 20x23 with a
 *     21x24 tap area on a 390x844 phone. `grep touch-target src` returned three
 *     call sites and this was not one of them.
 *   - `PageHeader`'s settings trigger is the app's one bare `size-9`, above the
 *     top of the enumeration rather than below the bottom of it: 36x36 beside
 *     the 44x44 its neighbours get.
 *   - `ToneSwatches` drew five 16x16 discs 22px apart, which fails WCAG 2.5.8
 *     on the size rule and on the spacing exception both, in the smallest
 *     interactive control in the app.
 *
 * The selector list is read out of the stylesheet rather than restated here, so
 * that removing `.touch-target` from the rule fails this test too. A test that
 * hardcodes the value under test cannot fail, and this codebase has already
 * shipped one of those.
 */

/** WCAG 2.5.8 Target Size (Minimum), AA. The reason the numbers below exist. */
const WCAG_MINIMUM_PX = 24

/** Tailwind's spacing scale: `size-6` is 6 x 0.25rem at a 16px root. */
const pxForSizeClass = (n: number) => n * 4

function coarsePointerRule(): string {
  const css = indexCss.replace(/\/\*[\s\S]*?\*\//g, '')
  const start = css.indexOf('@media (pointer: coarse)')
  expect(start).toBeGreaterThan(-1)
  return css.slice(start)
}

/**
 * The class names the coarse-pointer rule actually matches on.
 *
 * `[class*='size-7']` becomes `size-7`; `.touch-target` becomes
 * `touch-target`. Anything the rule does not name is, by definition, a control
 * the app leaves at its drawn size under a finger.
 */
function classesTheRuleReaches(): Set<string> {
  const rule = coarsePointerRule()
  const reached = new Set<string>()
  for (const m of rule.matchAll(/\[class\*='([a-z0-9-]+)'\]/g)) reached.add(m[1]!)
  for (const m of rule.matchAll(/\.([a-z][a-z0-9-]*)::?after/g)) reached.add(m[1]!)
  return reached
}

/** The className literal on the one `<PopoverTrigger>` in a component file. */
function triggerClasses(file: string, source: string): string {
  const open = source.indexOf('<PopoverTrigger')
  const close = source.indexOf('</PopoverTrigger>')
  expect(open).toBeGreaterThan(-1)
  expect(close).toBeGreaterThan(open)
  const found = /className="([^"]*)"/.exec(source.slice(open, close))
  expect(found, `no literal className on the <PopoverTrigger> in ${file}`).not.toBeNull()
  return found![1]!
}

describe('the coarse-pointer rule', () => {
  it('still enumerates the size classes and the opt-in this test relies on', () => {
    // Guards the guard. Every assertion below is a set-membership check against
    // this set, so an empty or half-parsed one would pass everything.
    const reached = classesTheRuleReaches()
    expect(reached).toContain('touch-target')
    expect(reached).toContain('size-6')
    expect(reached).toContain('size-8')
  })

  it('grows what it reaches to 44px', () => {
    // Stated from the stylesheet so the number in the comments above stays
    // honest if somebody retunes it.
    expect(coarsePointerRule()).toContain('width: 2.75rem')
  })
})

describe('controls the enumeration cannot reach on its own', () => {
  it("covers the keyword chip's chevron", () => {
    const classes = triggerClasses('KeywordChip.tsx', keywordChipSource).split(/\s+/)
    expect(classes.some((c) => classesTheRuleReaches().has(c))).toBe(true)
  })

  it("covers PageHeader's settings trigger, which is bigger than the list, not smaller", () => {
    const classes = triggerClasses('PageHeader.tsx', pageHeaderSource).split(/\s+/)
    expect(classes).toContain('size-9')
    expect(classes.some((c) => classesTheRuleReaches().has(c))).toBe(true)
  })
})

describe('ToneSwatches', () => {
  it('draws every tappable box at or above the WCAG minimum', () => {
    // The disc inside stays 16px — five of them have to fit a 240px popover —
    // so the assertion is on the box that takes the tap, which is the one
    // carrying `cursor-pointer`.
    // Line by line, not a whole-file lex: an apostrophe in a prose comment
    // opens a string for a whole-file regex and everything after it parses one
    // quote out of phase.
    const tappable = toneSwatchesSource
      .split('\n')
      .flatMap((line) => [...line.matchAll(/(['"`])([^'"`\n]*)\1/g)].map((m) => m[2]!))
      .filter((literal) => literal.split(/\s+/).includes('cursor-pointer'))

    expect(tappable).toHaveLength(1)
    for (const literal of tappable) {
      const size = /(?:^|\s)size-(\d+)(?:\s|$)/.exec(literal)
      expect(size, `no size-* on the tappable box: ${literal}`).not.toBeNull()
      expect(pxForSizeClass(Number(size![1]))).toBeGreaterThanOrEqual(WCAG_MINIMUM_PX)
    }
  })
})
