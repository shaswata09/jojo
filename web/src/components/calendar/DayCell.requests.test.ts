/**
 * Q051: every Calendar day cell shows its date at the top left whether or not
 * the day has events; today's date is legible on its circle; and the compact
 * cell height stays (a protected design choice).
 *
 * "Legible" is the bug that was reported: today rendered as a white glyph on a
 * white circle, because the text colour named a custom property this project
 * does not define. So the text colour is pinned to `--accent-fg`, and the two
 * colours are read out of `index.css` and measured against each other in both
 * themes. The rest is layout in the JSX, which D20 leaves to a source read.
 */

import { describe, expect, it } from 'vitest'
import indexCss from '@/index.css?raw'

const sources = import.meta.glob('/src/components/calendar/DayCell.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const source = sources['/src/components/calendar/DayCell.tsx'] ?? ''

/** The JSX the component returns. */
const view = /\n {2}return \(([\s\S]*)\n {2}\)\n\}/.exec(source)?.[1] ?? ''

function blockOf(css: string, selector: RegExp): string {
  const start = css.search(selector)
  if (start < 0) return ''
  const open = css.indexOf('{', start)
  let depth = 0
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1
    if (css[i] === '}' && --depth === 0) return css.slice(open + 1, i)
  }
  return ''
}

const hexOf = (block: string, name: string) =>
  new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(block)?.[1] ?? ''

/** WCAG relative luminance contrast between two #rrggbb colours. */
function contrast(a: string, b: string): number {
  const luminance = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => {
      const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (bl ?? 0)
  }
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05)
}

describe('a calendar day cell (Q051)', () => {
  it('was found', () => {
    expect(view).toContain('ref={setNodeRef}')
  })

  it('stacks from the top, with the date first and unconditional', () => {
    expect(view).toMatch(/'group\/cell relative flex flex-col rounded-md border p-1\.5 text-left/)
    // The first element inside the cell is the date button, outside any
    // condition on the day's events.
    const firstChild = /<div\s+ref=\{setNodeRef\}[\s\S]*?>\s*(?:\{\/\*[\s\S]*?\*\/\}\s*)*(<button[\s\S]*?<\/button>)/.exec(
      view,
    )?.[1] ?? ''
    expect(firstChild).toContain('{day}')
    expect(firstChild).toMatch(/className=\{cn\(\s*"grid size-5 shrink-0/)
  })

  it('draws today in the accent foreground on the accent circle', () => {
    expect(view).toContain("isToday ? 'bg-accent text-[color:var(--accent-fg)]' : 'text-text-2'")
  })

  for (const [theme, selector] of [
    ['light', /^:root,\s*html\[data-theme='light'\]\s*\{/m],
    ['dark', /^html\[data-theme='dark'\]\s*\{/m],
  ] as const) {
    it(`keeps today's digit readable on its circle in the ${theme} theme`, () => {
      const block = blockOf(indexCss, selector)
      const accent = hexOf(block, 'accent')
      const fg = hexOf(block, 'accent-fg')
      expect(accent).not.toBe('')
      expect(fg).not.toBe('')
      expect(contrast(accent, fg)).toBeGreaterThanOrEqual(4.5)
    })
  }

  it('keeps the compact cell heights', () => {
    expect(view).toContain("tall ? 'min-h-[56px] sm:min-h-[76px]' : 'min-h-[38px] sm:min-h-[48px]'")
  })
})
