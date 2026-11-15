/**
 * Owner requests about the dashboard's Pipeline (statistics) card.
 *
 * Q108: a toggle on the card switches between the pipeline, headline rates,
 *       when you applied, and what to work on next.
 * Q122: that toggle stays fixed at the top right whichever view is showing.
 *       `flex-wrap` used to drop it to a second line whenever the title grew.
 *
 * The views and the header only exist in the JSX, so D20 leaves a narrow
 * source read.
 */

import { describe, expect, it } from 'vitest'

const sources = import.meta.glob('/src/components/dashboard/StatsCard.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const source = sources['/src/components/dashboard/StatsCard.tsx'] ?? ''

/** The header row: everything from its opening div to the Segment's close. */
const header = /<div className="([^"]*)">\s*\{\/\*[\s\S]*?\*\/\}\s*<PanelTitle([\s\S]*?)<\/PanelTitle>\s*<Segment([\s\S]*?)\/>/.exec(
  source,
)

describe('the statistics card toggle (Q108)', () => {
  it('offers the four views', () => {
    const views = /const VIEWS = \[([\s\S]*?)\]/.exec(source)?.[1] ?? ''
    expect([...views.matchAll(/value: '(\w+)' as const/g)].map((m) => m[1])).toEqual([
      'pipeline',
      'rates',
      'when',
      'next',
    ])
  })

  it('opens on the pipeline', () => {
    expect(source).toContain("useState<ViewKey>('pipeline')")
  })

  it('renders the matching body for each view', () => {
    expect(source).toContain("{view === 'pipeline' ? <PipelineBody /> : null}")
    expect(source).toContain("{view === 'rates' ? <HeadlineRatesBody /> : null}")
    expect(source).toContain("{view === 'when' ? <ApplicationFrequencyBody /> : null}")
    expect(source).toContain("{view === 'next' ? <SearchHealthBody /> : null}")
  })

  it('is a control on the card that sets the view', () => {
    expect(header?.[3]).toMatch(/options=\{VIEWS\}\s+value=\{view\}\s+onChange=\{setView\}/)
  })
})

describe('where the toggle sits (Q122)', () => {
  it('was found', () => {
    expect(header).not.toBeNull()
  })

  it('shares one unwrapping row with the title, at its right end', () => {
    const row = (header?.[1] ?? '').split(/\s+/)
    expect(row).toContain('flex')
    expect(row).toContain('justify-between')
    expect(row).not.toContain('flex-wrap')
  })

  it('keeps its width while the title gives way', () => {
    expect(header?.[2]).toMatch(/className="[^"]*\bmin-w-0\b[^"]*\btruncate\b/)
    expect(header?.[3]).toMatch(/className="shrink-0"/)
  })
})
