/**
 * The snooze steps, the day each one lands on, and the buttons that print them.
 *
 * Three menus offer this — the reminders list, the dashboard's "Owed this week"
 * rows and its priority cards — and until now each carried its own `anchorOf`,
 * its own step list and its own copy of the popover-item class. The reminders
 * model said "Change one and change the other, or the label promises a Tuesday
 * and the store writes a Thursday"; that instruction had three targets and
 * named two.
 *
 * `components/common/` rather than beside the reminders model on purpose: the
 * model lives under `vault/`, and a dashboard panel that has to reach into
 * another feature's folder is exactly what made two of the three copies look
 * unavoidable. Split from `SnoozeSteps.tsx` only because a module that exports
 * both constants and a component loses fast refresh.
 */

import { TODAY } from '@/lib/today'

/**
 * Where a snooze counts from — a mirror of `useTimeline().snooze`, kept here so
 * a menu can print the date it is about to write.
 *
 * The store counts from today only when the item is already overdue; for
 * anything dated ahead it counts from that date. Change the store's rule and
 * change this, or every label in every one of the three menus promises a day
 * the write will not produce.
 *
 * `TODAY` IS READ HERE, PER CALL, and that is the whole reason this is a
 * function rather than a table of dates computed once. The store's half —
 * `timeline.item.snooze` in `tools/timeline.ts` — anchors on `dayOf(ctx.now)`,
 * the live clock. While `lib/today` pinned its day once at module load the two
 * came apart across midnight: measured on a tab opened at 23:50 and used at
 * 00:10, an overdue reminder anchored on the 12th here and on the 13th in the
 * store, so "Tomorrow" printed the 13th and the write landed on the 14th. The
 * pin moves at the day turn now, and reading it at call time is what lets this
 * follow it.
 */
export const snoozeAnchor = (date: string) => (date < TODAY ? TODAY : date)

/**
 * Three steps, spelled three ways, and the reason there are three.
 *
 * `soon`/`later` are for a menu hung off the date itself, as the reminders list
 * hangs it: there, "Tomorrow" is a lie on a reminder due next Friday — the
 * write would land on the Saturday — so the `later` spelling is used whenever
 * the anchor is not today. `duration` is for a menu under a "Push out by"
 * heading, as both dashboard panels use it: a duration is measured from the
 * anchor whatever the anchor is, so it cannot make that promise in the first
 * place and needs no second spelling.
 *
 * They are one array because a fourth step has to appear in all three menus,
 * and because the previous arrangement — the same `days` written out three
 * times — is how two of the three came to be silently correct rather than
 * deliberately so.
 */
export const SNOOZE_STEPS = [
  { days: 1, soon: 'Tomorrow', later: 'A day later', duration: 'A day' },
  { days: 3, soon: 'In 3 days', later: 'Three days later', duration: 'Three days' },
  { days: 7, soon: 'In 7 days', later: 'A week later', duration: 'A week' },
]
