/**
 * The relative-date vocabulary, which is written twice on purpose.
 *
 * `whenLabel` in `kg/core/dates.ts` and `relativeLabelOn` in
 * `kg/react/use-priority.ts` share five branches — overdue by one, overdue by N,
 * Today, Tomorrow, in N days. They are not unified because `whenLabel` takes a
 * whole `TimelineItem` and an offer's respond-by date has no timeline row behind
 * it, so the priority deck would have to fake one to borrow the formatter.
 *
 * `relativeLabelOn`'s comment carried the instruction "if that list ever grows a
 * case, this grows it too". This is that instruction as a gate. Without it the
 * two can diverge silently, and the symptom is one dashboard printing two
 * different sentences about the same date — the priority card and the reminders
 * row disagreeing about whether something is due Tomorrow.
 *
 * The gate stayed in `src/lib` when the deck moved below the seam, because both
 * halves of the comparison have to be measured against the SAME day and the day
 * a test can reach without a provider is `TODAY` — which nothing under `service/kg`
 * may import (D26). `relativeLabel` here is the binding that supplies it.
 *
 * Node-only, per D20: both are pure functions over strings.
 */

import { describe, expect, it } from 'vitest'
import { whenLabel } from '@jojo/service/core/dates'
import type { TimelineItem } from '@jojo/service/core/model'
import { relativeLabel } from '@/lib/priority'
import { TODAY } from '@/lib/today'

/**
 * `relativeLabel` reads the module-level `TODAY` (the wall clock) and cannot be
 * given a different one, so the dates under test are built FROM it rather than
 * pinned to a literal. A pinned date here would pass forever and test nothing
 * the day the clock moved past it.
 */
const dayFrom = (offset: number): string =>
  new Date(Date.parse(`${TODAY}T12:00:00`) + offset * 86_400_000).toISOString().slice(0, 10)

/** The minimum an item needs for `whenLabel` to reach its non-completed tail. */
const itemOn = (date: string): TimelineItem => ({
  id: 'item:test',
  title: 'test',
  date,
  allDay: true,
  kind: 'deadline',
  urgency: 'amber',
  remind: true,
})

describe('the relative-date vocabulary', () => {
  it('says the same thing as whenLabel across the whole range it covers', () => {
    // Well past the ±1 special cases in both directions, so a branch added at
    // either end — "in over a week", "last month" — shows up as a disagreement.
    const offsets = [-30, -14, -8, -3, -2, -1, 0, 1, 2, 3, 8, 14, 30]

    const spoken = offsets.map((offset) => {
      const date = dayFrom(offset)
      return { offset, priority: relativeLabel(date), timeline: whenLabel(itemOn(date), TODAY) }
    })

    for (const { offset, priority, timeline } of spoken) {
      expect({ offset, label: priority }).toEqual({ offset, label: timeline })
    }
  })

  it('names the five branches, so a silent rewrite of both at once still fails', () => {
    // The test above only proves the two AGREE — rewriting both to return '' in
    // one commit would keep it green. These pin what they agree on.
    expect(relativeLabel(dayFrom(0))).toBe('Today')
    expect(relativeLabel(dayFrom(1))).toBe('Tomorrow')
    expect(relativeLabel(dayFrom(3))).toBe('in 3 days')
    expect(relativeLabel(dayFrom(-1))).toBe('1 day overdue')
    expect(relativeLabel(dayFrom(-4))).toBe('4 days overdue')
  })
})
