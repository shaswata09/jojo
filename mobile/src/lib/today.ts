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
 * ## `TODAY` ADVANCES, and this is where the file stops being web's
 *
 * The web copy reads its day ONCE at module load, and the paragraph that used
 * to stand here said so: "a tab left open across midnight keeps yesterday until
 * it reloads". A phone has no tab and does not reload. Android and iOS keep the
 * JS context resident across backgrounding for days, so a day frozen at first
 * launch became this app's permanent idea of today, and three things went wrong
 * with it:
 *
 * - `posting-agent.ts` writes `capturedAt: now()` and `savedOn: TODAY` into the
 *   same record. One was this morning and the other was whenever the app was
 *   last cold-started — a durable date, wrong, inside a single row.
 * - `use-item-actions.ts` mirrors the store's snooze anchor so a menu can print
 *   the date it is about to write. The store's `today` is re-derived per render
 *   in `KgProvider` (`service/react/kg.tsx`), this one was not, so the menu
 *   promised a Tuesday and the store wrote a Wednesday — the exact drift that
 *   file's own comment exists to prevent.
 * - `lib/priority.ts` had already given up on this constant for the provider's
 *   day, writing that "a phone process is the one that stays resident for days".
 *   That was the fix for one consumer; this is the fix for the other 28.
 *
 * It advances inside `now()`, not on a timer and not on a foreground event.
 * Every write and every `KgProvider` render already calls the clock, and taking
 * the day from the SAME instant is what makes a stamp and its date unable to
 * disagree. A timer would re-render every dated label on a schedule nobody asked
 * for; an `AppState` listener would pull `react-native` into a module that
 * `marks.test.ts` already reaches through `marks.ts`, in a runner whose whole
 * claim (`vitest.config.mts`) is that it never boots a React Native environment.
 *
 * What is deliberately NOT solved here: a screen already on the glass does not
 * repaint at midnight, because nothing subscribes. It shows the new day the next
 * time it renders. That is a smaller lie than the one it replaces — hours, not
 * days — and closing it means making `today` a subscription, which is a change
 * to 28 call sites rather than to this one file.
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
 *
 * It also carries `TODAY` over midnight, from this same instant — see the header.
 */
export function now(): Instant {
  const at = instant()
  advanceTo(dayOf(at))
  return at
}

/** The raw read, so a stamp and its day can never come from two of them. */
function instant(): Instant {
  return new Date().toISOString()
}

function splitFor(day: ISODate): { year: number; month: number; day: number } {
  const { y, m, d } = partsOf(day)
  return { year: y, month: m, day: d }
}

/**
 * Move the day, and only when it actually turned.
 *
 * The early return is what keeps `TODAY_PARTS` referentially stable across the
 * hundreds of clock reads a session makes on one day: `CalendarScreen` builds
 * its month grid in a `useMemo` and `DateField` compares the object's fields on
 * every render, so handing out a fresh object per write would rebuild the grid
 * whenever anything at all was saved.
 */
function advanceTo(day: ISODate): void {
  if (day === TODAY) return
  TODAY = day
  TODAY_PARTS = splitFor(day)
}

/**
 * The calendar day the user is standing in.
 *
 * Through `dayOf` rather than `.slice(0, 10)`, so it is the LOCAL day: at 8pm in
 * Austin the UTC string already says tomorrow, and every "due today" on the
 * screen would have been a day out for the whole evening.
 *
 * `let` rather than `const` because `now()` moves it. An `import { TODAY }` is a
 * live binding, so all 28 call sites read the current day on their next read
 * and not one of them had to change.
 */
export let TODAY: ISODate = dayOf(instant())

/** The same day split for the calendar grids, which page by year and month. */
export let TODAY_PARTS: { year: number; month: number; day: number } = splitFor(TODAY)
