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
 * `src/lib` is the web adapter layer and is allowed a platform API; `src/data`
 * and `service/kg` are not, which is why the constant moved here rather than staying
 * where its callers found it. `data/timeline.ts` deleted its own `todayISO()`
 * for that reason and the reason has not changed — the fixtures keep
 * `SEED_TODAY`, which is a fact about how they were written, not about now.
 *
 * PINNED, NOT LIVE — and re-pinned when the day turns.
 *
 * Read per call, two reads a millisecond apart either side of midnight return
 * different days, and a screen where the week strip disagrees with the overdue
 * count about what day it is has no honest reading. So the day is pinned, and
 * every surface reads the same pin.
 *
 * It used to be pinned ONCE, at module load, and that was wrong for a reason the
 * old comment did not consider. The pin is not the only clock in the app: every
 * tool takes the day from `ctx.now` (D26), live, at the moment of the write.
 * Measured on a session opened at 23:50 and used at 00:10 — a laptop nobody
 * closed — the two disagreed by a day, and the disagreement was not cosmetic:
 * `timeline.item.snooze` anchors on `dayOf(ctx.now)`, so the menu offering
 * "Tomorrow" printed the 13th from the frozen pin and the store wrote the 14th.
 * A label that promises a day the write will not produce is worse than a stale
 * label.
 *
 * The pin is therefore moved forward by a timer at the local midnight, and
 * re-checked whenever the tab comes back — a lid closed at 23:00 and opened at
 * 09:00 delivers its timer late, and `visibilitychange` is what makes the
 * correction immediate rather than a minute later. Reassignment can only happen
 * BETWEEN tasks (a timer callback and an event listener are both tasks), so
 * within any one synchronous render every read still sees one day, which is the
 * property the original pin existed to give and the one a live `dayOf(now())`
 * could not.
 *
 * What this still does NOT do is repaint. Nothing re-renders on the turn, so a
 * tab left untouched across midnight keeps yesterday's pixels until something
 * re-renders it — the alternative is re-rendering every dated label on a timer
 * nobody asked for. What it does do is stop the app WRITING a day it is not
 * showing.
 *
 * A module-level `const` derived from `TODAY` in some other file is outside
 * that guarantee, because the derivation runs once. This used to be stated here
 * as a known limit and left at that; SEVEN of them existed, and every one
 * measured a day out on a session opened at 23:50 and read at 00:10 — the
 * dashboard's spelled-out date, the week strip's tomorrow and week-end, the
 * calendar's today marker and its "back to" month label, the glance panel's
 * month tooltip, the calendar's URL defaults, and the event dialog's quick-date
 * chips. The audit that raised this listed the first six; the seventh
 * (`ScheduleFields`) was the only one that WRITES — its chip labelled "Today"
 * still carried yesterday twenty minutes after the turn, so pressing it filed a
 * reminder that was overdue before it was saved, which is precisely the
 * label-promises-what-the-write-will-not-produce failure this pin was made live
 * to stop. They now derive at render or, for `links.ts`, per call.
 * `today.test.ts` holds the line: a new module-scope const built from either
 * export fails it, whether it is written on one line or spread over four.
 */

import { partsOf } from '@/data/timeline'
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

const partsOfDay = (day: ISODate): { year: number; month: number; day: number } => {
  const { y, m, d } = partsOf(day)
  return { year: y, month: m, day: d }
}

/**
 * The calendar day the user is standing in.
 *
 * Through `dayOf` rather than `.slice(0, 10)`, so it is the LOCAL day: at 8pm in
 * Austin the UTC string already says tomorrow, and every "due today" on the
 * screen would have been a day out for the whole evening.
 *
 * `let`, so the binding every importer holds moves with the day. ESM exports are
 * live bindings; reassigning here is what carries the new day to the sixty-odd
 * call sites without any of them learning that the day can change.
 */
export let TODAY: ISODate = dayOf(now())

/** The same day split for the calendar grids, which page by year and month. */
export let TODAY_PARTS: { year: number; month: number; day: number } = partsOfDay(TODAY)

/**
 * Move the pin if — and only if — the local day has actually turned.
 *
 * Guarded on inequality so the identity of `TODAY_PARTS` survives a spurious
 * wake-up: the calendar grids hold it across renders, and handing them a fresh
 * object for the same day would be a `React.memo` miss on every cell for
 * nothing.
 */
function repin(): void {
  const day = dayOf(now())
  if (day === TODAY) return
  TODAY = day
  TODAY_PARTS = partsOfDay(day)
}

/**
 * The next local midnight, plus a small margin.
 *
 * `new Date(y, m, d + 1, ...)` rather than `+ 86_400_000`: on the two days a
 * year that are 23 or 25 hours long, a fixed 86.4 million milliseconds is not a
 * day, and the timer re-arms itself from the midnight it just fired at. Measured
 * in America/Chicago from midnight, which is where the repeat actually starts:
 *
 *     25-hour day, 1 Nov   + 86_400_000  ->  1 Nov 23:00 CST   day has NOT turned
 *     23-hour day, 8 Mar   + 86_400_000  ->  9 Mar 01:00 CDT   an hour late
 *
 * The long day is the one that breaks it: `repin` fires an hour early, finds the
 * same day, returns, and the pin then stays stale until the next event — which
 * on a machine nobody touches is the whole of that night. (The short day is only
 * an hour late, which is untidy rather than wrong.) Computing the next local
 * midnight has neither failure. The 250ms margin covers the timer firing a hair
 * early.
 */
function msUntilDayTurn(): number {
  const at = new Date()
  const midnight = new Date(at.getFullYear(), at.getMonth(), at.getDate() + 1, 0, 0, 0, 250)
  return Math.max(0, midnight.getTime() - at.getTime())
}

/**
 * Arms the next day turn, and re-arms from inside its own callback.
 *
 * A TRAP FOR FAKE-TIMER TESTS, deliberately kept. `vi.runAllTimers()` and
 * `vi.advanceTimersToNextTimer()` in a loop both try to drain the timer queue,
 * and this queue never drains: every callback queues its successor.
 *
 * MEASURED, because the audit finding that raised this guessed worse than the
 * truth: it predicted a test that "hangs forever", and on vitest 4 the run
 * aborts after 185ms with `Aborting after running 10000 timers, assuming an
 * infinite loop!`. That is a fast, named failure rather than a hang — which is
 * most of the reason this is left alone. What it does NOT say is which module
 * armed the timer, and that is the part worth writing down: `@/lib/links`
 * imports this file and half the app imports that, so the offending import can
 * be three levels below a test that never mentions a clock.
 *
 * ADVANCE BY A DURATION INSTEAD: `vi.advanceTimersByTimeAsync(ms)` runs only
 * the timers that fall inside the window and leaves the next one pending, which
 * is what every test in `today.test.ts` does.
 *
 * Left as it is rather than made cancellable, and that is a decision rather
 * than an omission. The re-arm IS the midnight advance — it is what stops the
 * app printing one day in a snooze menu and writing another through `ctx.now`,
 * and `today.test.ts` crosses TWO midnights on one import to hold it there.
 * (Not the 25-hour test: that one only ever needs a single timer to fire, so it
 * passes with the re-arm deleted — measured — and it self-skips in UTC anyway.)
 * An exported `stop` would be production surface existing only for a test
 * that has a working alternative one line away. No test in `web/src` reaches
 * for the draining helpers today (grepped); this comment is here so the first
 * one to try reads why it aborted instead of hunting a deadlock somewhere real.
 */
function scheduleDayTurn(): void {
  const handle = setTimeout(() => {
    repin()
    scheduleDayTurn()
  }, msUntilDayTurn())
  // Node keeps its event loop alive for a pending timer, so a 24-hour one would
  // hold a vitest worker open after the last assertion. Browsers have no such
  // notion and no `unref`; this is a no-op there.
  ;(handle as unknown as { unref?: () => void }).unref?.()
}

scheduleDayTurn()

// A backgrounded tab's timers are throttled to about one a minute, and a
// suspended machine's do not run at all until it wakes — so the timer alone
// would leave the pin behind by up to a whole night on the one gesture that
// makes it visible, which is coming back to the tab. Both events are cheap and
// idempotent: `repin` returns immediately when the day has not moved.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') repin()
  })
}
if (typeof window !== 'undefined') {
  window.addEventListener('focus', repin)
}
