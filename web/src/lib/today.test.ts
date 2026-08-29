/**
 * The pin, and the day it turns on.
 *
 * `TODAY` is what sixty-odd surfaces measure against, and it used to be pinned
 * once at module load. A session opened at 23:50 and used at 00:10 then read a
 * different day from the store, which takes its day live from `ctx.now` — so
 * the snooze menu printed one date and `timeline.item.snooze` wrote another.
 * These tests hold the two together.
 *
 * The clock is faked and the module imported inside each test, because the pin
 * is taken at import: `vi.resetModules()` is what makes "module load" a thing a
 * test can place in time.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { dayOf } from '@jojo/service/core/project'
// `?raw` rather than `node:fs`: the app project's `types` is `["vite/client"]`,
// so `node:fs` does not typecheck here — the same reason `links.test.ts` reads
// `index.html` this way. Sources, not modules: the derived-value tests at the
// bottom are about what runs at IMPORT versus what runs at render, and only the
// text distinguishes those.
import owedThisWeekSrc from '@/components/dashboard/OwedThisWeek.tsx?raw'
import monthGridSrc from '@/components/calendar/MonthGrid.tsx?raw'
import dayRailSrc from '@/components/calendar/DayRail.tsx?raw'
import glancePanelSrc from '@/components/dashboard/GlancePanel.tsx?raw'
import dashboardSrc from '@/routes/Dashboard.tsx?raw'
import scheduleFieldsSrc from '@/components/timeline/dialog/ScheduleFields.tsx?raw'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.resetModules()
})

/** 23:50 LOCAL, whatever zone the machine is in. */
const lateOnThe12th = new Date(2026, 9, 12, 23, 50, 0)

describe('the pinned day', () => {
  it('is the LOCAL day, not the UTC day the instant slices to', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(lateOnThe12th)
    const { TODAY, now } = await import('@/lib/today')
    expect(TODAY).toBe('2026-10-12')
    // West of UTC the ISO string has already rolled over; the pin must not.
    expect(TODAY).toBe(dayOf(now()))
  })

  it('agrees with the day a tool would stamp, twenty minutes after midnight', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(lateOnThe12th)
    const today = await import('@/lib/today')
    expect(today.TODAY).toBe('2026-10-12')

    // The tab is left open. Twenty minutes of timers run.
    await vi.advanceTimersByTimeAsync(20 * 60_000)

    // `dayOf(ctx.now)` is what `timeline.item.snooze` anchors on. The pin the
    // menus print must be the same day, or the label promises a date the write
    // will not produce.
    expect(today.TODAY).toBe('2026-10-13')
    expect(today.TODAY).toBe(dayOf(today.now()))
    expect(today.TODAY_PARTS).toEqual({ year: 2026, month: 10, day: 13 })
  })

  it('re-arms: TWO midnights turn on one import', async () => {
    /*
     * The second turn is the one that needs the re-arm. The first timer is
     * armed at import and fires once; only its own callback can queue the next,
     * so a `scheduleDayTurn()` dropped from inside the callback leaves the pin
     * stuck on the 13th for ever after.
     *
     * Deliberately NOT relying on the 25-hour test below for that coverage.
     * That one self-skips in a zone without DST, which is what a CI runner set
     * to UTC is — measured: with `TZ=UTC` it returns early and a missing
     * re-arm goes unnoticed. Mid-October has no transition in any zone, so
     * 24 hours is 24 hours here and this assertion is real everywhere.
     */
    vi.useFakeTimers()
    vi.setSystemTime(lateOnThe12th)
    const today = await import('@/lib/today')

    await vi.advanceTimersByTimeAsync(20 * 60_000)
    expect(today.TODAY).toBe('2026-10-13')

    await vi.advanceTimersByTimeAsync(24 * 3_600_000)
    expect(today.TODAY).toBe('2026-10-14')
  })

  it('catches up when the tab comes back from a machine that was asleep', async () => {
    // A suspended machine runs no timers at all, so the midnight one is still
    // pending when the lid opens. `visibilitychange` is the correction.
    let onVisible: (() => void) | undefined
    vi.stubGlobal('document', {
      visibilityState: 'visible',
      addEventListener: (type: string, fn: () => void) => {
        if (type === 'visibilitychange') onVisible = fn
      },
    })
    vi.useFakeTimers()
    vi.setSystemTime(lateOnThe12th)
    const today = await import('@/lib/today')
    expect(today.TODAY).toBe('2026-10-12')

    // Ten hours pass with the process suspended: the clock moved, no timer ran.
    vi.setSystemTime(new Date(2026, 9, 13, 9, 0, 0))
    expect(onVisible).toBeDefined()
    onVisible?.()
    expect(today.TODAY).toBe('2026-10-13')
  })

  /**
   * The first local day of `year` that is twenty-five hours long, or null in a
   * zone that has no such day.
   *
   * Midnight-to-midnight is the only span that matters here, because that is
   * exactly the interval the repeating day-turn timer has to cover.
   */
  const longDayIn = (year: number): Date | null => {
    for (let m = 0; m < 12; m++) {
      for (let d = 1; d <= 31; d++) {
        const from = new Date(year, m, d)
        if (from.getDate() !== d) continue
        const to = new Date(year, m, d + 1)
        if (to.getTime() - from.getTime() === 25 * 3_600_000) return from
      }
    }
    return null
  }

  it('turns on the LOCAL midnight of a 25-hour day, not 24 hours after the last one', async () => {
    /*
     * The timer re-arms itself from the midnight it just fired at, so on the one
     * night a year that is twenty-five hours long a fixed `+ 86_400_000` fires an
     * hour EARLY. Measured in America/Chicago from 1 Nov 00:00 CDT: it lands at
     * 1 Nov 23:00 CST, `repin` finds the same day and returns, and the pin is
     * then stale for the rest of that night — on a machine nobody touches there
     * is no event to correct it. (The 23-hour day is only an hour late, which is
     * untidy rather than wrong.)
     */
    const start = longDayIn(2026)
    if (start === null) {
      // UTC, Tokyo, Kiritimati: every day is twenty-four hours and nothing here
      // can tell the two schedulings apart. Said out loud rather than passing
      // silently — this test is real only where the zone makes it real.
      expect(new Date(2026, 0, 1).getTimezoneOffset()).toBe(
        new Date(2026, 6, 1).getTimezoneOffset(),
      )
      return
    }

    vi.useFakeTimers()
    vi.setSystemTime(start)
    const today = await import('@/lib/today')
    const longDay = today.TODAY

    // Twenty-four hours and a minute in, the local day has NOT turned yet.
    await vi.advanceTimersByTimeAsync(24 * 3_600_000 + 60_000)
    expect(today.TODAY).toBe(longDay)

    // The twenty-fifth hour is the one that turns it.
    await vi.advanceTimersByTimeAsync(3_600_000)
    expect(today.TODAY).not.toBe(longDay)
  })

  it('keeps one TODAY_PARTS object while the day has not turned', async () => {
    // The calendar grids hold it across renders; a fresh object for the same
    // day is a React.memo miss on every cell for nothing.
    let onVisible: (() => void) | undefined
    vi.stubGlobal('document', {
      visibilityState: 'visible',
      addEventListener: (type: string, fn: () => void) => {
        if (type === 'visibilitychange') onVisible = fn
      },
    })
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 12, 9, 0, 0))
    const today = await import('@/lib/today')
    const before = today.TODAY_PARTS
    vi.setSystemTime(new Date(2026, 9, 12, 17, 30, 0))
    onVisible?.()
    expect(today.TODAY_PARTS).toBe(before)
  })
})

/**
 * What is DERIVED from the pin, and whether it follows the pin.
 *
 * The tests above prove the pin moves. They do not prove that anything built
 * from it moves with it, and for a while nothing did: seven module-level consts
 * across the dashboard, the calendar, the event dialog and the link builders
 * were computed once at import and then stayed on whatever day the tab was
 * opened on. Every one measured a day out on a session opened at 23:50 and read
 * at 00:10 — the dashboard's spelled-out date, the week strip's tomorrow and
 * week-end, the calendar's today marker and its "back to" month label, the
 * glance panel's month tooltip, the calendar's URL defaults, and the event
 * dialog's Today / Tomorrow / In 7 days chips.
 *
 * The audit that found this listed six. `ScheduleFields` was the seventh and
 * the only one that WRITES: measured with fake timers, its chip labelled
 * "Today" still carried 2026-10-12 twenty minutes after the pin moved to the
 * 13th, so pressing it filed a reminder that was overdue before it was saved.
 * The list below is therefore checked by name and kept longer than the finding.
 *
 * Two shapes of test, because the defect has two halves:
 *
 *  - behavioural, on the only derivative with a public surface. The calendar's
 *    defaults decide both which params are omitted from a URL and which day a
 *    bare `/calendar` opens on, so a frozen copy is wrong in both directions at
 *    once.
 *  - structural, over the six components. D20 bans mounting them, so there is
 *    no way to observe a render; what CAN be checked, and what the defect
 *    actually was, is that none of them derives a value from the pin at module
 *    scope again.
 */
describe('what is derived from the pin', () => {
  it('moves the calendar defaults across a local midnight', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(lateOnThe12th)
    const today = await import('@/lib/today')
    const { calendarDate, calendarPath } = await import('@/lib/links')

    // Before midnight: today is the 12th, so a link to the 12th collapses to
    // the bare path and the bare path reads back as the 12th.
    expect(calendarPath({ y: 2026, m: 10, d: 12 })).toBe('/calendar')
    expect(calendarDate(new URLSearchParams())).toEqual({ y: 2026, m: 10, d: 12 })

    await vi.advanceTimersByTimeAsync(20 * 60_000)
    expect(today.TODAY).toBe('2026-10-13')

    // Both halves have to move together. Frozen, the builder kept '?d=13' in
    // every "go to today" link it wrote — 13 was no longer "the default" —
    // while the reader answered a bare '/calendar' with the 12th, so the day
    // panel opened on yesterday and an event added from it was stamped
    // yesterday.
    expect(calendarPath({ y: 2026, m: 10, d: 13 })).toBe('/calendar')
    expect(calendarDate(new URLSearchParams())).toEqual({ y: 2026, m: 10, d: 13 })

    // And the day that is now yesterday has to start appearing in the URL,
    // which is the half a "recompute the default" fix can still get wrong.
    expect(calendarPath({ y: 2026, m: 10, d: 12 })).toBe('/calendar?d=12')
  })

  /**
   * The six components that held a frozen derivative, with what each froze.
   * Named rather than globbed: a glob would quietly stop covering a file
   * somebody renamed. Longer than the audit's own inventory by one — see above.
   */
  // `was` before `src`, because `it.each` fills the title's `%s` positionally
  // and a whole component's source in a test name is unreadable.
  const SOURCES: ReadonlyArray<[name: string, was: string, src: string]> = [
    ['OwedThisWeek', 'TOMORROW / WEEK_END', owedThisWeekSrc],
    ['MonthGrid', 'TODAY_ISO', monthGridSrc],
    ['DayRail', 'TODAY_MONTH', dayRailSrc],
    ['GlancePanel', 'MONTH_TODAY', glancePanelSrc],
    ['Dashboard', 'TODAY_LABEL', dashboardSrc],
    ['ScheduleFields', 'QUICK_DATES', scheduleFieldsSrc],
  ]

  /**
   * Source with comments stripped.
   *
   * Every one of these files now EXPLAINS the pin in prose above the code, and
   * those explanations name `TODAY_PARTS` — so a check reading the raw text
   * would fail on the very comments this fix added.
   */
  const codeOf = (src: string) =>
    src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')

  /**
   * A line at column 0 that opens a new top-level construct.
   *
   * Column 0 is what separates module scope from render scope — everything
   * inside a component or a hook is indented — but the CLOSING lines of a
   * multi-line initialiser (`]`, `}`, `} ${...}`) sit at column 0 too and are
   * still part of the declaration above them. Only a line that starts a fresh
   * construct ends one.
   */
  const OPENS_A_TOP_LEVEL_CONSTRUCT =
    /^(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:async\s+)?(?:const|let|var|function|class|type|interface|enum|import|export)\b/

  /**
   * Every module-scope `const`/`let`/`var`, WITH the lines that continue it.
   *
   * Whole declarations rather than single lines, and that is a fix rather than
   * a tidying. The per-line version this replaced tested each line on its own,
   * so Dashboard's actual defect walked straight through it: the opening line
   * read ``const TODAY_LABEL = `${`` — which names no pin, because `\bTODAY\b`
   * does not match inside `TODAY_LABEL` — and the lines that DID name
   * `TODAY_PARTS` were indented continuations and so were read as render scope.
   * Measured: the original defect restored verbatim left this file green, 12/12
   * passing. Taking the declaration whole makes it not matter which of its
   * lines the identifier falls on.
   *
   * OVER-FIRES ON PURPOSE on a module-scope helper whose BODY reads the pin.
   * That one would be safe — a function body runs when it is called, not at
   * import — but telling the two apart needs a parser, and none of the six
   * files has one. The precedent when somebody wants one is `spellOut` in
   * `Dashboard.tsx`: take the parts as a parameter and the question does not
   * arise.
   */
  const moduleScopeDeclarations = (src: string): string[] => {
    const declarations: string[] = []
    let current: string[] | null = null
    const flush = () => {
      if (current) declarations.push(current.join('\n'))
      current = null
    }
    for (const line of codeOf(src).split('\n')) {
      const atColumnZero = line !== '' && !/^\s/.test(line)
      if (atColumnZero && OPENS_A_TOP_LEVEL_CONSTRUCT.test(line)) {
        flush()
        if (/^(?:export\s+)?(?:const|let|var)\s/.test(line)) current = [line]
      } else if (current) current.push(line)
    }
    flush()
    return declarations
  }

  it.each(SOURCES)('%s derives nothing from the pin at module scope (was: %s)', (_n, _w, src) => {
    // A module-scope const runs once at import and then holds whatever day the
    // tab was opened on; a render-scope one runs on every render and so follows
    // the pin. Nothing here may be the former.
    const frozen = moduleScopeDeclarations(src).filter((d) => /\bTODAY(_PARTS)?\b/.test(d))

    expect(frozen).toEqual([])
  })

  it('leaves all six still reading the pin', () => {
    // Guards the guard: deleting the import satisfies the check above and
    // leaves a component that has stopped knowing what day it is.
    for (const [, , src] of SOURCES) {
      expect(codeOf(src)).toMatch(/from '@\/lib\/today'/)
    }
  })
})
