/**
 * Owner requests about the dashboard's At a glance card.
 *
 * Q006: the glance stats are four small tiles in one block, and the dashboard
 *       has application statistics charts (frequency and category).
 * Q014: the four stats are compact and share a two-row block with a small
 *       calendar.
 * Q038: the calendar card is split in two — picking a date lists that day's
 *       planned activity — and today's marker never runs into the next day's.
 *
 * The stat labels changed after Q014 on purpose (see the comment on `stats` in
 * GlancePanel: Applications became Done today, Follow-ups due became Overdue),
 * so the count and the shape are pinned here, not the words.
 *
 * Layout only exists in the JSX; D20 leaves a narrow source read.
 */

import { describe, expect, it } from 'vitest'

const sources = import.meta.glob(
  [
    '/src/components/dashboard/GlancePanel.tsx',
    '/src/components/dashboard/StatsCard.tsx',
    '/src/routes/Statistics.tsx',
  ],
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>

const glance = sources['/src/components/dashboard/GlancePanel.tsx'] ?? ''

/** The `stats` memo's array. */
const stats = /const stats = useMemo\(\(\) => \{[\s\S]*?return \[([\s\S]*?)\n {4}\]\n/.exec(glance)?.[1] ?? ''

describe('the glance stats (Q006, Q014)', () => {
  it('are four', () => {
    expect(stats.match(/^ {6}\{$/gm)).toHaveLength(4)
  })

  it('sit two by two in one block, as figures rather than tall tiles', () => {
    expect(glance).toMatch(/<ul className="grid grid-cols-2 gap-x-4 gap-y-2\.5">\s*\{stats\.map/)
    // A baseline-aligned figure and label on one line, not a centred numeral.
    expect(glance).toMatch(/className="group flex items-baseline gap-1\.5/)
    expect(glance).toMatch(/'tabular text-xl font-semibold/)
  })

  it('share the card with the month, as its second row', () => {
    const counters = glance.indexOf('{stats.map(')
    const month = glance.indexOf('{cells.map(')
    expect(counters).toBeGreaterThan(0)
    expect(month).toBeGreaterThan(counters)
    // One Panel holds both.
    expect(glance.match(/<Panel\b/g)).toHaveLength(1)
  })
})

describe('the statistics charts (Q006)', () => {
  it('are on the dashboard through the statistics card', () => {
    expect(sources['/src/components/dashboard/StatsCard.tsx']).toContain(
      "{view === 'when' ? <ApplicationFrequencyBody /> : null}",
    )
  })

  it('include frequency and category on the Statistics page', () => {
    const page = sources['/src/routes/Statistics.tsx'] ?? ''
    expect(page).toContain('<ApplicationFrequency />')
    expect(page).toContain('<ApplicationSources />')
  })
})

describe('the glance calendar (Q038)', () => {
  it('splits into the month and the selected day when there is room', () => {
    expect(glance).toContain('<div className="grid gap-x-4 gap-y-3 @[21rem]:grid-cols-2">')
  })

  it('selects a day on click and lists that day', () => {
    expect(glance).toMatch(/onClick=\{\(\) => setSelected\(day\)\}/)
    expect(glance).toContain('const dayEvents = eventsByDay.get(selected) ?? []')
    expect(glance).toMatch(/dayEvents\.map\(\(e\) =>/)
  })

  it('keeps today and the next day apart', () => {
    // Columns with a gap between them, and a marker that can never be wider
    // than its column.
    expect(glance).toContain('<div className="grid grid-cols-7 gap-x-0.5 gap-y-1" role="presentation">')
    expect(glance).toMatch(/'tabular grid aspect-square w-full max-w-5 place-items-center rounded-full/)
    // The selection ring is not drawn around today's filled circle.
    expect(glance).toMatch(/isSelected &&\s*!isToday &&\s*'ring-2/)
  })
})
