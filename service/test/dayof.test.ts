/**
 * `dayOf` reads the calendar day of the timezone the reader is standing in.
 *
 * HERE RATHER THAN BESIDE `core/project.ts`, because pinning it needs `TZ` and
 * `process` is not a name the portable layers may see — `types/portable-globals.
 * d.ts` grants one global at a time and deliberately does not grant this one.
 * `service/test/` is the project that owns tests needing a host, and a claim
 * about the local timezone is exactly that.
 *
 * It needed pinning because `dayOf`'s own doc argues this at more length than
 * anything else in the file — "'2026-10-12T23:40:00Z'.slice(0, 10) is the 12th,
 * but anyone in Texas reading that screen is on the evening of the 12th and
 * anyone in Tokyo is on the morning of the 13th" — and replacing the entire body
 * with that very `slice(0, 10)` passed all 453 tests. Nothing pinned `TZ`, and
 * in `America/Chicago`, where these fixtures were authored, the local day and
 * the UTC day of the seed's instants agree.
 *
 * `dayOf` is what `ctx.now` becomes wherever a tool stamps a date — `savedOn`,
 * `completedOn`, `appliedOn`, the deadline urgency, and `today` in
 * `react/kg.tsx` — so the whole dashboard is measured against whatever this
 * returns.
 */

import { describe, expect, it } from 'vitest'
import { dayOf } from '../kg/core/project'

describe('dayOf', () => {
  const inZone = (tz: string, at: string) => {
    const previous = process.env['TZ']
    process.env['TZ'] = tz
    try {
      return dayOf(at)
    } finally {
      // Restored per case rather than set once for the file: Node re-reads TZ
      // on the next Date operation, so leaving it set would make every other
      // test in the package answer in whichever zone happened to be set last —
      // an order dependency that only shows up on someone else's machine.
      process.env['TZ'] = previous
    }
  }

  it('reads the local day, which is a different date east and west of the instant', () => {
    // 23:40 UTC: still the 12th in Austin, already the 13th in Tokyo. A UTC
    // slice says the 12th to both, so every 'completed today' and every
    // `daysAgo` on the Tokyo reader's dashboard is measured against yesterday.
    expect(inZone('America/Chicago', '2026-10-12T23:40:00.000Z')).toBe('2026-10-12')
    expect(inZone('Asia/Tokyo', '2026-10-12T23:40:00.000Z')).toBe('2026-10-13')

    // And the other way: 02:30 UTC is still the 11th in Austin. The UTC slice
    // says the 12th, so 'due today' fires a day early for the whole Americas.
    expect(inZone('America/Chicago', '2026-10-12T02:30:00.000Z')).toBe('2026-10-11')
    expect(inZone('Asia/Tokyo', '2026-10-12T02:30:00.000Z')).toBe('2026-10-12')
  })

  it('pads the month and the day, because an ISODate is fixed width', () => {
    // `addDays`, `daysBetween` and every `<` comparison in the calendar treat an
    // ISODate as sortable text, and '2026-1-5' sorts after '2026-11-05'.
    expect(inZone('UTC', '2026-01-05T12:00:00.000Z')).toBe('2026-01-05')
  })
})
