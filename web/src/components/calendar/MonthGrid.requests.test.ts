/**
 * Q044: the Calendar page's month header has previous/next arrows that work
 * both ways, a go-to-month picker between the title and the arrows, and a
 * control between the arrows that returns to the current month.
 *
 * The centre control is a "Today" word now rather than the 6px dot first
 * built — the comment in MonthGrid gives the reason — so this pins what it
 * does, not how it is drawn. `stepMonth` itself is tested in
 * `service/kg/core/calendar.requests.test.ts`; this pins that the arrows call
 * it with -1 and +1. D20 bans mounting, so it is a narrow source read.
 */

import { describe, expect, it } from 'vitest'

const sources = import.meta.glob('/src/components/calendar/MonthGrid.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const source = sources['/src/components/calendar/MonthGrid.tsx'] ?? ''

/** The header row, from the title to the end of the arrow group. */
const header = /<h2 className="text-base font-medium">([\s\S]*?)<\/Panel>/.exec(source)?.[0] ?? ''

describe('the calendar month header (Q044)', () => {
  it('was found', () => {
    expect(header).toContain('{month.label}')
  })

  it('puts the month picker between the title and the arrows', () => {
    const title = header.indexOf('</h2>')
    const picker = header.indexOf('<MonthPicker year={month.year} month={month.month} onPick={onGoTo} />')
    const previous = header.indexOf('aria-label="Previous month"')
    expect(title).toBeGreaterThan(0)
    expect(picker).toBeGreaterThan(title)
    expect(previous).toBeGreaterThan(picker)
  })

  it('steps back with the previous arrow and forward with the next', () => {
    expect(header).toMatch(
      /onClick=\{\(\) => onGoTo\(stepMonth\(month\.year, month\.month, -1\)\)\}\s*aria-label="Previous month"/,
    )
    expect(header).toMatch(
      /onClick=\{\(\) => onGoTo\(stepMonth\(month\.year, month\.month, 1\)\)\}\s*aria-label="Next month"/,
    )
  })

  it('returns to the current month from the control between the arrows', () => {
    const previous = header.indexOf('aria-label="Previous month"')
    const home = header.indexOf('onClick={() => onGoTo({ year: TODAY_PARTS.year, month: TODAY_PARTS.month })}')
    const next = header.indexOf('aria-label="Next month"')
    expect(home).toBeGreaterThan(previous)
    expect(next).toBeGreaterThan(home)
  })
})
