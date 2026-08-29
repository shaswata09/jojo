/**
 * The half of the snooze rule that prints, held against the half that writes.
 *
 * `timeline.item.snooze` anchors on `dayOf(ctx.now)` — live. This file's
 * `snoozeAnchor` anchors on `TODAY` — pinned. The two agreed for as long as
 * nobody left a tab open across midnight; measured at 23:50 and again at 00:10
 * they were a day apart, and the menu offering "Tomorrow" on an overdue
 * reminder printed the 13th while the store wrote the 14th.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { addDays } from '@jojo/service/core/dates'
import { dayOf } from '@jojo/service/core/project'

afterEach(() => {
  vi.useRealTimers()
  vi.resetModules()
})

/** What `tools/timeline.ts` does, spelled out, so the two rules face each other. */
const storeAnchor = (date: string, at: string) => {
  const today = dayOf(at)
  return date < today ? today : date
}

describe('snoozeAnchor', () => {
  it('counts an overdue reminder from today and a future one from its own date', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 12, 9, 0, 0))
    const { snoozeAnchor } = await import('@/components/common/snooze')
    expect(snoozeAnchor('2026-10-05')).toBe('2026-10-12')
    expect(snoozeAnchor('2026-10-20')).toBe('2026-10-20')
  })

  it('still promises the day the store will write, twenty minutes after midnight', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 12, 23, 50, 0))
    const { snoozeAnchor } = await import('@/components/common/snooze')
    const { now } = await import('@/lib/today')
    const overdue = '2026-10-05'
    expect(addDays(snoozeAnchor(overdue), 1)).toBe('2026-10-13')

    // The tab is left open past midnight.
    await vi.advanceTimersByTimeAsync(20 * 60_000)

    expect(snoozeAnchor(overdue)).toBe(storeAnchor(overdue, now()))
    // "Tomorrow" now prints the 14th, which is what the write produces.
    expect(addDays(snoozeAnchor(overdue), 1)).toBe('2026-10-14')
  })
})
