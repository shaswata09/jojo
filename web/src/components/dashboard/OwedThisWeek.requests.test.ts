/**
 * Owner requests about the dashboard's Owed this week card.
 *
 * Q237: a long title in a Later card stays inside its container. Measured at
 *       1440px with a 113-character title, the chip ran 49px past the panel.
 * Q288: clicking a reminder asks whether to edit it or open its application,
 *       rather than going straight to edit.
 *
 * Both only exist in the JSX, so D20 leaves a narrow source read of the
 * specific classes and branches.
 */

import { describe, expect, it } from 'vitest'

const sources = import.meta.glob('/src/components/dashboard/OwedThisWeek.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const source = sources['/src/components/dashboard/OwedThisWeek.tsx'] ?? ''

/** The JSX of the Later strip, from its heading to the end of its list. */
const later = /\{t\('owed\.later'\)\}\s*<\/div>([\s\S]*?)<\/ul>/.exec(source)?.[1] ?? ''

/** The body of `OpenItemMenu`. */
const menu = /function OpenItemMenu\([\s\S]*?\n\}\n/.exec(source)?.[0] ?? ''

describe('a long title in the Later strip (Q237)', () => {
  it('was found', () => {
    expect(later).toContain('later.slice(0, LATER_SHOWN)')
  })

  it('is capped at the width of the strip, down the whole chain', () => {
    // A flex item will not shrink below its content without min-w-0.
    expect(later).toContain('<li key={e.id} className="max-w-full min-w-0">')
    expect(later).toMatch(/<OpenItemMenu[\s\S]*?className="block max-w-full/)
    expect(later).toMatch(/<Chip tone="gray" className="max-w-full/)
  })

  it('truncates the title and keeps the date whole', () => {
    expect(later).toContain('<span className="min-w-0 truncate">{e.title}</span>')
    expect(later).toContain(
      '<span className="shrink-0 text-text-3">· {domain.shortDate(e.date)}</span>',
    )
  })
})

describe('clicking an owed item (Q288)', () => {
  it('opens through the menu, from the row title and the Later chip', () => {
    expect(source.match(/<OpenItemMenu\b/g)?.length).toBe(2)
  })

  it('asks edit or open when the item is filed under an application', () => {
    expect(menu).toMatch(/<Popover open=\{open\} onOpenChange=\{setOpen\}>/)
    expect(menu).toMatch(/onEdit\(\)\s*\}\}\s*>[\s\S]*?\{t\(`owed\.edit\.\$\{noun\}`\)\}/)
    expect(menu).toMatch(/applications\.map\(\(a\) => \([\s\S]*?void navigate\(appPath\(a\)\)/)
  })

  it('goes straight to edit only when there is no application to offer', () => {
    expect(menu).toMatch(
      /if \(applications\.length === 0\) \{\s*return \(\s*<button type="button" onClick=\{onEdit\}/,
    )
  })
})

describe('a long overdue backlog (perf-3)', () => {
  it('renders the first overdue rows only, with a way to show the rest', () => {
    // 334 overdue rows each mounted two popovers and a store subscription, and
    // one tick held the main thread for hundreds of milliseconds.
    expect(source).toMatch(/const OVERDUE_SHOWN = \d+/)
    expect(source).toMatch(
      /capped && !allOverdue \? group\.items\.slice\(0, OVERDUE_SHOWN\) : group\.items/,
    )
    expect(source).toContain('{rows.map((e) => {')
    expect(source).not.toContain('{group.items.map((e) => {')
    expect(source).toMatch(/onClick=\{\(\) => setAllOverdue\(!allOverdue\)\}/)
    expect(source).toContain("t('owed.showAll', { total: group.items.length })")
  })
})
