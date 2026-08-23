/**
 * The colour law, at the two points this file owns it.
 *
 * `markOfDate` and `markOf` are bindings of the shared rules in
 * `@jojo/service/core/timeline-view` — they take `TODAY` so that no call site
 * has to hold a clock (D26) — and the shared half is tested where it lives.
 * What is only here, and had no test at all, is the part that decides what a
 * DAY looks like when it holds several items, and the two maps that turn a mark
 * into something a component can render.
 *
 * `strongestMark`'s ranking is a fact about the domain rather than about the
 * phone, and the same table is written out a second time inside a `useMemo` in
 * web's `components/dashboard/GlancePanel.tsx`. Pinned here so that the copy on
 * this side cannot drift silently; where the rule should ultimately live is a
 * question for the package, not for this file.
 */

import { describe, expect, it } from 'vitest'
import { markColor, markOf, markOfDate, markTone, strongestMark } from './marks'
import type { Mark } from './marks'
import type { TimelineItem } from '@jojo/service/data/timeline'
import type { Palette } from '@/theme/tokens'

const MARKS: Mark[] = ['done', 'overdue', 'soon', 'none']

describe('strongestMark — which mark wins when a day holds several items', () => {
  it('has nothing to say about a day with nothing on it', () => {
    expect(strongestMark([])).toBeUndefined()
  })

  it('returns the only mark there is', () => {
    for (const mark of MARKS) expect(strongestMark([mark])).toBe(mark)
  })

  it('ranks overdue over soon over none', () => {
    expect(strongestMark(['none', 'soon'])).toBe('soon')
    expect(strongestMark(['soon', 'overdue'])).toBe('overdue')
    expect(strongestMark(['none', 'soon', 'overdue'])).toBe('overdue')
  })

  /**
   * The line the comment in `marks.ts` is about: `done` ranks below everything,
   * so a day whose work is finished shows the hollow marker, and a day with one
   * live item still shows that item's colour rather than being greyed out by
   * the three finished ones beside it.
   */
  it('lets one live item outrank any number of finished ones', () => {
    expect(strongestMark(['done', 'done', 'none'])).toBe('none')
    expect(strongestMark(['done', 'soon'])).toBe('soon')
    expect(strongestMark(['done', 'done', 'done'])).toBe('done')
  })

  it('does not depend on the order they arrive in', () => {
    expect(strongestMark(['overdue', 'done'])).toBe('overdue')
    expect(strongestMark(['done', 'overdue'])).toBe('overdue')
  })
})

describe('the maps a component renders through', () => {
  /**
   * A missing key here is `undefined` handed to a style prop, which React
   * Native renders as the default colour rather than as an error — so a mark
   * added to the union and forgotten in one of these maps is invisible.
   */
  it('covers every mark in both directions', () => {
    const palette = { danger: '#d00', warning: '#f90', text3: '#888' } as Palette
    for (const mark of MARKS) {
      expect(markTone[mark]).toBeTruthy()
      expect(markColor(mark, palette)).toBeTruthy()
    }
  })

  it('spends colour only on overdue and soon', () => {
    const palette = { danger: '#d00', warning: '#f90', text3: '#888' } as Palette
    expect(markColor('overdue', palette)).toBe(palette.danger)
    expect(markColor('soon', palette)).toBe(palette.warning)
    // The law, stated in the header: everything further out is neutral however
    // important it is, and a completed item is never past due.
    expect(markColor('none', palette)).toBe(palette.text3)
    expect(markColor('done', palette)).toBe(palette.text3)
    expect(markTone.overdue).toBe('danger')
    expect(markTone.soon).toBe('warning')
    expect(markTone.done).toBe('muted')
    expect(markTone.none).toBe('muted')
  })
})

describe('the bindings that carry today for their callers', () => {
  const today = '2026-08-20'

  it('reads a date against the day it is given', () => {
    expect(markOfDate('2026-08-19', today)).toBe('overdue')
    expect(markOfDate('2026-08-21', today)).toBe('soon')
    expect(markOfDate('2026-09-30', today)).toBe('none')
  })

  /**
   * A completed item is never past due whatever its date says. This is the
   * shared rule, asserted here because it is the one that reaches the screen
   * through THIS binding and because getting `completedOn` wrong at the seam
   * would paint a finished deadline red.
   */
  it('never calls a completed item overdue', () => {
    const done: TimelineItem = {
      id: 'i1',
      title: 'Submitted',
      date: '2026-01-01',
      allDay: true,
      kind: 'deadline',
      urgency: 'gray',
      remind: false,
      applicationIds: [],
      completedOn: '2026-01-01',
    }
    expect(markOf(done, today)).toBe('done')
    const { completedOn: _completedOn, ...live } = done
    expect(markOf(live, today)).toBe('overdue')
  })
})
