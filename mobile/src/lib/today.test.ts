/**
 * The clock, and the one thing about it that is not true of the web copy.
 *
 * `TODAY` used to be `const`, read once at module load, and on a browser tab
 * that is defensible — the tab reloads. This process does not. Android and iOS
 * keep the JS context resident for days, so the day read at first launch was
 * the app's idea of today for the rest of the week: `posting-agent` stamped
 * `savedOn` with it while `capturedAt` came from the live clock, and the snooze
 * menu in `use-item-actions` printed a date the store would not write.
 *
 * Every case here re-imports the module under a fake clock, because the thing
 * being tested is what happens BETWEEN module load and a later read — a single
 * import held across a system-time change is the whole point, so `resetModules`
 * runs before each import rather than after each assertion.
 *
 * Local `new Date(y, m, d, …)` throughout, never a UTC string: the assertions
 * are about the day the READER is standing in, and pinning them to UTC would
 * make the suite pass or fail depending on the machine's zone. `dayOf`'s own
 * timezone behaviour is pinned in `service/test/dayof.test.ts`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Today = typeof import('./today')

/** Load the module as if the app had just cold-started at this local moment. */
async function launchAt(at: Date): Promise<Today> {
  vi.setSystemTime(at)
  vi.resetModules()
  return import('./today')
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.resetModules()
})

describe('TODAY at launch', () => {
  /**
   * BOTH ends of the day, because one alone only catches half the planet.
   * Replacing the body with `instant().slice(0, 10)` — the mistake `dayOf`'s
   * own doc spends a paragraph on — passes the 23:59 case in Tokyo and the
   * 00:30 case in Austin. Only the pair fails everywhere except UTC itself,
   * where local and UTC are the same day and nothing can tell them apart.
   */
  it('is the local day, not the UTC day of the same instant', async () => {
    // 23:59 local: west of Greenwich the UTC string already says the 27th, so a
    // slice puts every "due today" a day out for the whole evening.
    const evening = await launchAt(new Date(2026, 7, 26, 23, 59, 0))
    expect(evening.TODAY).toBe('2026-08-26')

    // 00:30 local: east of Greenwich the UTC string still says the 25th, so a
    // slice measures the morning's dashboard against the day before last.
    const morning = await launchAt(new Date(2026, 7, 26, 0, 30, 0))
    expect(morning.TODAY).toBe('2026-08-26')
  })

  it('splits into the parts the calendar grids page by', async () => {
    const today = await launchAt(new Date(2026, 0, 5, 9, 0, 0))
    expect(today.TODAY).toBe('2026-01-05')
    expect(today.TODAY_PARTS).toEqual({ year: 2026, month: 1, day: 5 })
  })
})

describe('TODAY over midnight, in a process that never restarted', () => {
  it('advances on the next clock read', async () => {
    const today = await launchAt(new Date(2026, 7, 26, 23, 59, 0))
    expect(today.TODAY).toBe('2026-08-26')

    // The user backgrounds the app and comes back after midnight. Nothing
    // reloaded; the module is the same one.
    vi.setSystemTime(new Date(2026, 7, 27, 0, 1, 0))
    today.now()

    expect(today.TODAY).toBe('2026-08-27')
    expect(today.TODAY_PARTS).toEqual({ year: 2026, month: 8, day: 27 })
  })

  it('gives a write the same day its own timestamp carries', async () => {
    // `posting-agent.ts` builds `{ capturedAt: now(), savedOn: TODAY }` in one
    // object literal, in that order. This is the invariant that literal needs:
    // whatever instant the stamp holds, the day beside it is that instant's day.
    const today = await launchAt(new Date(2026, 7, 26, 23, 59, 0))
    vi.setSystemTime(new Date(2026, 7, 27, 0, 1, 0))

    const record = { capturedAt: today.now(), savedOn: today.TODAY }

    expect(record.savedOn).toBe('2026-08-27')
    expect(new Date(record.capturedAt).getDate()).toBe(27)
  })

  it('crosses a year, where the parts all move at once', async () => {
    const today = await launchAt(new Date(2026, 11, 31, 23, 59, 0))
    vi.setSystemTime(new Date(2027, 0, 1, 0, 30, 0))
    today.now()

    expect(today.TODAY).toBe('2027-01-01')
    expect(today.TODAY_PARTS).toEqual({ year: 2027, month: 1, day: 1 })
  })
})

describe('what a clock read must NOT disturb', () => {
  it('keeps TODAY_PARTS the same object while the day has not turned', async () => {
    // `CalendarScreen` builds its month grid in a `useMemo` and `DateField`
    // reads the fields every render. A fresh object per clock read would
    // rebuild the grid on every save the user makes during the day.
    const today = await launchAt(new Date(2026, 7, 26, 9, 0, 0))
    const before = today.TODAY_PARTS

    vi.setSystemTime(new Date(2026, 7, 26, 17, 30, 0))
    today.now()

    expect(today.TODAY_PARTS).toBe(before)
  })

  it('still returns the instant, not the day', async () => {
    // `now()` is what `createdAt` and `capturedAt` are made of; an ISO date
    // here would collapse the order the journal reads back in.
    const today = await launchAt(new Date(2026, 7, 26, 9, 0, 0))
    expect(today.now()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  })

  it('reads the clock per call rather than answering with the launch instant', async () => {
    const today = await launchAt(new Date(2026, 7, 26, 9, 0, 0))
    const first = today.now()
    vi.setSystemTime(new Date(2026, 7, 26, 9, 0, 5))
    expect(today.now()).not.toBe(first)
  })
})
