/**
 * The clock. The only wall-clock read in the app, and the day everything on
 * screen is measured against.
 *
 * Until Wave 4 this was `TODAY = '2026-10-12'` in `@/data/timeline` — a literal
 * the fixtures were authored around — and sixty-odd call sites imported it. That
 * was correct for exactly as long as the store died on reload. With IndexedDB
 * underneath it stopped being correct on the second launch: a record the user
 * created last Tuesday said "0 days ago" because `daysAgo` was measured against
 * an October that never moves, the calendar put its today marker on 12 October
 * for the rest of time, and a reminder ticked off in March was stamped
 * 2026-10-12. The fixtures move to meet the wall clock now (`repo/seed.ts`
 * shifts every authored date by a whole number of days at seed time), so this is
 * the constant that decides where they land.
 *
 * `src/lib` is this app's adapter layer and is allowed a platform API; nothing
 * below the seam is, which is why the constant lives here rather than where its
 * callers first found it. That seam has moved since: `src/data` is gone and
 * `src/kg` holds only the AsyncStorage driver, so the layer this must not sit
 * in is `@jojo/service` — D26, enforced by `check-platform.mjs`. The fixtures
 * keep `SEED_TODAY`, which is a fact about how they were written, not about
 * now.
 *
 * Read ONCE at module load, not per call. Two reads a millisecond apart either
 * side of midnight return different days, and a screen where the week strip
 * disagrees with the overdue count about what day it is has no honest reading.
 * A tab left open across midnight keeps yesterday until it reloads; that is the
 * same behaviour the pinned constant had, and the alternative is re-rendering
 * every dated label on a timer nobody asked for.
 */

import { partsOf } from '@jojo/service/data/timeline'
import type { ISODate, Instant } from '@jojo/service/core/model'
import { dayOf } from '@jojo/service/core/project'

/**
 * The live clock, for stamping writes.
 *
 * Passed to `KgProvider` as `now` (D26) and read nowhere else: a tool that wants
 * the time takes it from `ToolContext`. Unlike `TODAY` this is read per call —
 * `createdAt` is a fact about the moment of the write, and freezing it at module
 * load would give every record in a session the same timestamp and collapse the
 * order the journal reads back in.
 */
export function now(): Instant {
  return new Date().toISOString()
}

/**
 * The calendar day the user is standing in.
 *
 * Through `dayOf` rather than `.slice(0, 10)`, so it is the LOCAL day: at 8pm in
 * Austin the UTC string already says tomorrow, and every "due today" on the
 * screen would have been a day out for the whole evening.
 */
export const TODAY: ISODate = dayOf(now())

/** The same day split for the calendar grids, which page by year and month. */
export const TODAY_PARTS: { year: number; month: number; day: number } = (() => {
  const { y, m, d } = partsOf(TODAY)
  return { year: y, month: m, day: d }
})()
