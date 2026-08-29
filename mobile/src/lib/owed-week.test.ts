/**
 * The two audited defects in "Owed this week", each as a case that fails when
 * the defect is put back.
 *
 * Written against `lib/owed-week.ts` rather than the screen because D20 bans
 * mounting a component, and the screen is where both bugs lived unassertably.
 * Nothing here reads a clock: the day is handed in, so "the day turned" is one
 * more call with a later argument.
 */

import { describe, expect, it } from 'vitest'
import type { TimelineItem } from '@jojo/service/data/timeline'
import { owedWeek, weekStrip } from '@/lib/owed-week'

const DAY = '2026-10-12'

/** Only the four fields this module reads; the rest of the item is scenery. */
const item = (id: string, date: string, completedOn?: string): TimelineItem =>
  ({
    id,
    date,
    kind: 'reminder',
    title: id,
    applicationIds: [],
    ...(completedOn === undefined ? {} : { completedOn }),
  }) as unknown as TimelineItem

const WORLD = [
  item('overdue', '2026-10-11'),
  item('today', '2026-10-12'),
  item('tomorrow-a', '2026-10-13'),
  item('tomorrow-b', '2026-10-13'),
  item('friday', '2026-10-16'),
  item('next-week', '2026-10-25'),
  item('done', '2026-10-12', '2026-10-12'),
]

describe('the counts under the panel title', () => {
  /**
   * The mutant this exists for: `dueCount: today.length + tomorrow.length + …`,
   * where `tomorrow` was the module-level arrow function and `.length` was its
   * arity. Two items are due tomorrow here precisely so the difference between
   * counting them and counting a function's parameters is 2, not 0 — with one
   * item the wrong answer and "the group is empty" are the same number.
   */
  it('counts tomorrow, which the arity typo dropped', () => {
    const owed = owedWeek(WORLD, DAY)
    expect(owed.dueCount).toBe(4) // today + two tomorrow + friday
    expect(owed.groups[2]?.items.map((i) => i.id)).toEqual(['tomorrow-a', 'tomorrow-b'])
  })

  it('keeps overdue out of the due count — the hint reports them separately', () => {
    const owed = owedWeek(WORLD, DAY)
    expect(owed.overdueCount).toBe(1)
    expect(owed.dueCount).toBe(4)
  })

  it('counts only what was completed on the day asked about', () => {
    expect(owedWeek(WORLD, DAY).doneToday).toBe(1)
    expect(owedWeek(WORLD, '2026-10-13').doneToday).toBe(0)
  })

  it('leaves completed items out of every open group', () => {
    const owed = owedWeek(WORLD, DAY)
    const shown = [...owed.groups.flatMap((g) => g.items), ...owed.later].map((i) => i.id)
    expect(shown).not.toContain('done')
    expect(owed.later.map((i) => i.id)).toEqual(['next-week'])
  })
})

describe('the day turning under a resident process', () => {
  /**
   * The second mutant: the strip was `useMemo(..., [])` and the groups
   * `useMemo(..., [all])`, so past midnight the panel kept the day it first
   * rendered. Here the store does not change at all — only the day does — and
   * every number has to move anyway.
   */
  it('re-files an item from Today to Overdue when only the day moves', () => {
    const before = owedWeek(WORLD, DAY)
    const after = owedWeek(WORLD, '2026-10-13')

    expect(before.groups[1]?.items.map((i) => i.id)).toEqual(['today'])
    expect(after.groups[0]?.items.map((i) => i.id)).toEqual(['overdue', 'today'])
    expect(after.overdueCount).toBe(2)
    // Tomorrow's two are today's two now, and Saturday the 17th has joined the week.
    expect(after.groups[1]?.items.map((i) => i.id)).toEqual(['tomorrow-a', 'tomorrow-b'])
  })

  it('starts the strip on the day it was given, which the panel draws as today', () => {
    expect(weekStrip(DAY)[0]?.iso).toBe('2026-10-12')
    expect(weekStrip(DAY)).toHaveLength(7)
    expect(weekStrip(DAY)[6]?.iso).toBe('2026-10-18')
    expect(weekStrip('2026-10-13')[0]?.iso).toBe('2026-10-13')
    // 12 October 2026 is a Monday; the labels have to follow the dates, not the index.
    expect(weekStrip(DAY).map((c) => c.label)).toEqual([
      'Mon',
      'Tue',
      'Wed',
      'Thu',
      'Fri',
      'Sat',
      'Sun',
    ])
  })
})
