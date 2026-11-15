/**
 * Owner requests about the dashboard Pipeline card.
 *
 * Q035: every stage has its own colour, so no two stages share one. Draft and
 *       Closed used to share --text-3, and Submitted and Screen shared --info.
 * Q082: the card is a coloured pie of applications per stage. The phone side
 *       is checked in `mobile/src/screens/TodayScreen.requests.test.ts`.
 *
 * The colours are read out of `index.css`, light and dark, because a token
 * that resolves to the same hex as another is the bug Q035 describes even
 * when the variable names differ.
 */

import { describe, expect, it } from 'vitest'
import { STAGES } from '@/data/seed'
import indexCss from '@/index.css?raw'

const sources = import.meta.glob('/src/components/dashboard/PipelineBreakdown.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const source = sources['/src/components/dashboard/PipelineBreakdown.tsx'] ?? ''

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

const THEMES = {
  light: blockOf(indexCss, /^:root,\s*html\[data-theme='light'\]\s*\{/m),
  dark: blockOf(indexCss, /^html\[data-theme='dark'\]\s*\{/m),
}

const stageHex = (block: string, stage: string) =>
  new RegExp(`--stage-${stage}:\\s*(#[0-9a-fA-F]{6})`).exec(block)?.[1]?.toLowerCase()

describe('the stage colours (Q035)', () => {
  it('cover all six stages', () => {
    expect([...STAGES].map((s) => s.id)).toEqual([
      'draft',
      'submitted',
      'screen',
      'interview',
      'offer',
      'closed',
    ])
  })

  for (const [theme, block] of Object.entries(THEMES)) {
    it(`are six different colours in the ${theme} theme`, () => {
      expect(block).not.toBe('')
      const hexes = STAGES.map((s) => stageHex(block, s.id))
      expect(hexes.every(Boolean), String(hexes)).toBe(true)
      expect(new Set(hexes).size).toBe(STAGES.length)
    })
  }

  it('give each pie slice its own stage token', () => {
    const fill = /const STAGE_FILL: Record<Stage, string> = \{([\s\S]*?)\}/.exec(source)?.[1] ?? ''
    for (const s of STAGES) expect(fill).toContain(`${s.id}: 'var(--stage-${s.id})'`)
    expect(source).toContain('color: STAGE_FILL[s.id]')
  })
})

describe('the Pipeline card (Q082)', () => {
  it('draws a pie of applications per stage', () => {
    expect(source).toMatch(/<Pie[\s\S]*?data=\{stageCounts\.map\(\(s\) => \(\{[\s\S]*?value: s\.count,/)
  })
})
