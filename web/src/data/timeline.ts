/**
 * One model for anything with a date on it.
 *
 * The same real-world event used to be typed five ways — `Deadline`,
 * `FollowUp`, `AgendaEvent`, `Reminder` and `CalendarEvent` — with no key
 * joining the copies, so ticking off "UT Austin statements" in the Vault could
 * never reach the calendar or the dashboard. Every row from those five arrays
 * is transcribed below exactly once, keyed to the application it belongs to.
 */

import type { TimelineItem } from '@/kg/core/model'

export type { TimelineItem, TimelineKind } from '@/kg/core/model'

/** Which end of the day a row falls in. A reading of an item, not a field. */
export type TimelineBucket = 'overdue' | 'today' | 'upcoming' | 'done'

/**
 * The day the fixtures below were WRITTEN against. Not today, and never today.
 *
 * Everything relative in the old arrays agrees on this date: "8 days overdue"
 * against a due of Oct 4, "in 34 days" against the Baylor deadline of Nov 15,
 * and the 12th falling on the Monday the dashboard's week strip opens with.
 *
 * It was called `TODAY` and the whole app imported it as today, which was true
 * for as long as the store died on reload and false from Wave 2 onward — a demo
 * opened in 2027 showed an October eight months gone, every deadline overdue and
 * nothing due. It is a property of the fixtures now, read by exactly one caller:
 * `repo/seed.ts` measures the gap between this and the real day and shifts every
 * authored date across by that whole number of days. Today itself lives in
 * `src/lib/today.ts`, which is allowed to read a clock.
 *
 * Do not move it to keep pace with the calendar. The dates below are authored
 * against it; changing one without the others breaks the seeded story.
 */
export const SEED_TODAY = '2026-10-12'

/* ------------------------------ date plumbing ----------------------------- */

/**
 * Dates are plain strings and every operation goes through explicit y/m/d
 * parts. `new Date('2026-10-12')` is parsed as UTC midnight, so anywhere west
 * of Greenwich `getDate()` hands back the 11th — a date that silently shifts by
 * a day is far worse than one that fails loudly. ISO strings also sort
 * lexicographically, so bucketing needs no parsing at all.
 */
const pad = (n: number) => String(n).padStart(2, '0')

export function isoOf(y: number, m: number, d: number): string {
  // Round-tripped through a local Date so out-of-range parts normalise —
  // October the 34th becomes November the 3rd rather than an impossible string.
  const at = new Date(y, m - 1, d)
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`
}

export function partsOf(iso: string): { y: number; m: number; d: number } {
  const [y, m, d] = iso.split('-')
  return { y: Number(y), m: Number(m), d: Number(d) }
}

export function addDays(iso: string, n: number): string {
  const { y, m, d } = partsOf(iso)
  return isoOf(y, m, d + n)
}

/*
 * `todayISO()` used to live here and is deliberately gone.
 *
 * It read the wall clock, and it sat in the one directory `repo` and `tools` are
 * both allowed to import (check-layers.mjs:59,66) — so a tool could have reached
 * the clock through it without ever writing `new Date()`, which is the exact
 * thing D26 puts behind ToolContext.now. It had zero call sites in all of src/,
 * so nothing broke; what it had was a loaded gun inside the alias D26 protects.
 * Anything needing today's date takes it as an argument, the way `today` already
 * flows down from KgProvider.
 */

/**
 * Both endpoints are rebuilt at UTC midnight before subtracting. Subtracting
 * two local Dates loses or gains an hour across a daylight-saving boundary,
 * which rounds to the wrong whole day and shows "in 1 day" for tomorrow twice.
 */
export function daysBetween(from: string, to: string): number {
  const a = partsOf(from)
  const b = partsOf(to)
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86_400_000)
}

/**
 * Whole days from the day the fixtures were written to `today`. The rebase.
 *
 * ONE offset applied to every date, not a per-record regeneration. "Submitted
 * three weeks before the first reply", "replied to on the second day of the
 * month after", "this deadline falls on the Monday the week strip opens with" —
 * every one of those is a relationship the fixtures encode by hand, and
 * re-deriving each date from today would have dissolved all of them into a set
 * of individually plausible, mutually unrelated dates. A constant shift moves
 * the story without touching a single thing inside it.
 *
 * Whole DAYS, not hours: the fixtures are 'YYYY-MM-DD' throughout, and an offset
 * with a time component in it would have rounded some dates over a boundary and
 * not others, which is the one way a constant shift can still lose a
 * relationship.
 */
export function seedOffset(today: string): number {
  return daysBetween(SEED_TODAY, today)
}

const MONTHS_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]

/** 'Nov 15'. */
export const shortDate = (iso: string) => {
  const { m, d } = partsOf(iso)
  return `${MONTHS_SHORT[m - 1]} ${d}`
}

const clock = (mins: number) => `${pad(Math.floor(mins / 60) % 24)}:${pad(mins % 60)}`

/* -------------------------------- selectors ------------------------------- */

export function bucketOf(item: TimelineItem, today: string): TimelineBucket {
  if (item.completedOn) return 'done'
  if (item.date < today) return 'overdue'
  if (item.date === today) return 'today'
  return 'upcoming'
}

/**
 * The past-tense half of `whenLabel`'s vocabulary: 'today' · 'yesterday' ·
 * '5 days ago' · 'Sep 21'.
 *
 * Deliberately lowercase-leading, because every consumer today is a fragment —
 * "saved 5 days ago", "Completed yesterday". A month name still capitalises
 * itself, so the sentence reads correctly either way; a capitalised 'Today'
 * would only read correctly in the one position nobody uses it in.
 *
 * The two-week cut-off is the whole point of the law. Past this, the gap stops
 * being the information ("Sep 21" is what you would say out loud) and a count
 * of days becomes arithmetic the reader has to do. It is also what kills the
 * hand-written '3 weeks ago' / '1 month ago' strings the vault used to ship —
 * frozen copy that could never change and disagreed with every dated surface
 * in the app.
 *
 * A future date falls through to the plain date: nothing is "ago".
 */
export function agoLabel(iso: string, today: string): string {
  const gap = daysBetween(iso, today)
  if (gap < 0) return shortDate(iso)
  if (gap === 0) return 'today'
  if (gap === 1) return 'yesterday'
  if (gap < 14) return `${gap} days ago`
  return shortDate(iso)
}

/** '8 days overdue' · 'Today' · 'in 2 days' · 'Completed 3 days ago'. */
export function whenLabel(item: TimelineItem, today: string): string {
  // One vocabulary: the completed branch used to jump straight from
  // "yesterday" to a bare date, so a reminder ticked off three days ago and one
  // ticked off three weeks ago were rendered in the same shape.
  if (item.completedOn) return `Completed ${agoLabel(item.completedOn, today)}`

  const gap = daysBetween(today, item.date)
  if (gap === -1) return '1 day overdue'
  if (gap < 0) return `${-gap} days overdue`
  if (gap === 0) return 'Today'
  if (gap === 1) return 'Tomorrow'
  return `in ${gap} days`
}

/** '09:30 – 10:15', or null for an all-day item. */
export function timeLabel(item: TimelineItem): string | null {
  if (item.allDay || item.startMins === undefined) return null
  const start = clock(item.startMins)
  return item.durationMins ? `${start} – ${clock(item.startMins + item.durationMins)}` : start
}

/** Day, then all-day items above timed ones, then by start time. */
export function compareItems(a: TimelineItem, b: TimelineItem): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1
  if (a.allDay !== b.allDay) return a.allDay ? -1 : 1
  return (a.startMins ?? 0) - (b.startMins ?? 0)
}

/* ---------------------------------- seed ---------------------------------- */

/**
 * Sorted by `compareItems` so consumers can slice without re-sorting.
 *
 * Where a deadline, a reminder and a calendar entry described the same real
 * event they are merged into one row here: the merged row keeps the calendar's
 * title, the reminder's note, and `remind: true` if any of the copies was a
 * reminder.
 *
 * The `urgency` on every row below is dead weight and this comment used to
 * claim otherwise — "the calendar legend reads from it". It does not, and
 * neither does anything else: the calendar, the glance grid, "Owed this week"
 * and the priority deck all derive their colour from the date
 * (`lib/timeline-visuals.ts`). The field survives here only because
 * `TimelineItemProps` in `kg/core/model.ts` still requires it, and that is a
 * persisted shape — dropping it is a migration, not an edit. It goes when the
 * model does.
 */
export const timeline: TimelineItem[] = [
  {
    id: 'stripe-referral',
    title: 'Ask D. Chen for a referral',
    date: '2026-09-28',
    allDay: true,
    kind: 'admin',
    urgency: 'gray',
    applicationId: 'stripe',
    remind: true,
    completedOn: '2026-09-28',
  },
  {
    id: 'tamu-submit',
    title: 'Submit application',
    date: '2026-10-02',
    allDay: true,
    kind: 'deadline',
    urgency: 'gray',
    applicationId: 'tamu',
    remind: true,
    completedOn: '2026-10-02',
  },
  {
    id: 'ut-receipt',
    title: 'Confirm application was received',
    note: 'Search chair: Dr. Smith',
    date: '2026-10-04',
    allDay: true,
    kind: 'follow-up',
    urgency: 'red',
    applicationId: 'ut-austin',
    remind: true,
  },
  {
    id: 'tamu-nudge',
    title: 'Nudge on application status',
    note: 'No response in 21 days',
    date: '2026-10-06',
    allDay: true,
    kind: 'follow-up',
    urgency: 'red',
    applicationId: 'tamu',
    remind: true,
  },
  {
    id: 'databricks-chase',
    title: 'Chase recruiter reply',
    note: 'They said "next week" on Oct 3',
    date: '2026-10-09',
    allDay: true,
    kind: 'follow-up',
    urgency: 'amber',
    applicationId: 'databricks',
    remind: true,
  },
  {
    id: 'ut-statements',
    title: 'Finalize UT Austin statements',
    detail: 'Research, teaching and diversity',
    note: 'Deadline is Thursday',
    date: '2026-10-12',
    allDay: true,
    kind: 'prep',
    urgency: 'red',
    applicationId: 'ut-austin',
    remind: true,
  },
  {
    id: 'advisor-sync',
    title: 'Advisor sync',
    detail: 'Chase the third reference letter for Texas Tech',
    date: '2026-10-13',
    allDay: false,
    startMins: 15 * 60,
    durationMins: 30,
    kind: 'call',
    urgency: 'amber',
    applicationId: 'texas-tech',
    remind: false,
  },
  {
    id: 'tt-letters',
    title: 'Request third reference letter',
    date: '2026-10-14',
    allDay: true,
    kind: 'admin',
    urgency: 'amber',
    applicationId: 'texas-tech',
    remind: true,
  },
  {
    id: 'ut-austin-deadline',
    title: 'UT Austin — Assistant professor, CS',
    detail: 'Application deadline · research, teaching and diversity statements',
    date: '2026-10-15',
    allDay: true,
    kind: 'deadline',
    urgency: 'red',
    applicationId: 'ut-austin',
    remind: false,
  },
  {
    id: 'stripe-cv',
    title: 'Tailor CV for Stripe',
    detail: 'Assistant can draft from the posting',
    date: '2026-10-16',
    allDay: true,
    kind: 'prep',
    urgency: 'gray',
    applicationId: 'stripe',
    remind: true,
  },
  {
    id: 'stripe-deadline',
    title: 'Stripe — ML engineer',
    detail: 'Application deadline · referral from D. Chen',
    date: '2026-10-18',
    allDay: true,
    kind: 'deadline',
    urgency: 'amber',
    applicationId: 'stripe',
    remind: false,
  },
  {
    id: 'tamu-deadline',
    title: 'Texas A&M — ECE',
    detail: 'Application deadline',
    date: '2026-10-22',
    allDay: true,
    kind: 'deadline',
    urgency: 'gray',
    applicationId: 'tamu',
    remind: false,
  },
  {
    id: 'rice-draft',
    title: 'Draft Rice statements',
    detail: 'Statistics position',
    date: '2026-10-24',
    allDay: true,
    kind: 'prep',
    urgency: 'gray',
    applicationId: 'rice',
    remind: false,
  },
  {
    id: 'uh-travel',
    title: 'Book travel for campus visit',
    note: 'Visit is Nov 6',
    date: '2026-10-24',
    allDay: true,
    kind: 'admin',
    urgency: 'gray',
    applicationId: 'uh',
    remind: true,
  },
  // The Texas Tech deadline existed as a dashboard deadline only — the calendar
  // never carried it, so the month view was missing a hard date entirely.
  {
    id: 'tt-deadline',
    title: 'Texas Tech — Assistant professor, ECE',
    detail: 'Application deadline · 3 reference letters required',
    date: '2026-10-27',
    allDay: true,
    kind: 'deadline',
    urgency: 'gray',
    applicationId: 'texas-tech',
    remind: false,
  },
  {
    id: 'texas-tech-zoom',
    title: 'Texas Tech — committee Zoom',
    detail: 'Search committee screen',
    date: '2026-10-28',
    allDay: false,
    startMins: 14 * 60,
    durationMins: 45,
    kind: 'interview',
    urgency: 'amber',
    applicationId: 'texas-tech',
    remind: false,
    joinUrl: 'https://zoom.us/j/88451209335',
  },
  {
    id: 'stripe-onsite',
    title: 'Stripe — onsite',
    detail: '5 rounds',
    date: '2026-10-30',
    allDay: false,
    startMins: 9 * 60,
    durationMins: 6 * 60,
    kind: 'interview',
    urgency: 'amber',
    applicationId: 'stripe',
    remind: false,
    location: 'Stripe — South San Francisco',
  },
  // Dated Nov 1, not the Nov 5 that the dashboard's "in 24 days" implied: the
  // calendar entry and the application note both say Nov 1, and two explicit
  // dates beat one relative count.
  {
    id: 'rice-deadline',
    title: 'Rice — Statistics',
    detail: 'Application deadline · draft not started',
    date: '2026-11-01',
    allDay: true,
    kind: 'deadline',
    urgency: 'red',
    applicationId: 'rice',
    remind: false,
  },
  {
    id: 'uh-rehearse',
    title: 'Rehearse UH job talk',
    detail: 'Full run-through with the group',
    date: '2026-11-03',
    allDay: false,
    startMins: 10 * 60,
    durationMins: 90,
    kind: 'prep',
    urgency: 'amber',
    applicationId: 'uh',
    remind: false,
  },
  {
    id: 'uh-visit',
    title: 'UH — campus visit',
    detail: 'Job talk and meetings',
    date: '2026-11-06',
    allDay: true,
    kind: 'visit',
    urgency: 'amber',
    applicationId: 'uh',
    remind: false,
    location: 'University of Houston',
  },
  {
    id: 'baylor-offer',
    title: 'Baylor — respond to offer',
    detail: 'Decision deadline',
    note: 'Negotiating startup package',
    date: '2026-11-15',
    allDay: true,
    kind: 'deadline',
    urgency: 'red',
    applicationId: 'baylor',
    remind: true,
  },
  {
    id: 'unt-deadline',
    title: 'UNT — Assistant professor, CS',
    detail: 'Application deadline',
    date: '2026-11-20',
    allDay: true,
    kind: 'deadline',
    urgency: 'gray',
    applicationId: 'unt',
    remind: false,
  },
]

/* ------------------------------- back-compat ------------------------------ */

export const remindersOf = (items: TimelineItem[]): TimelineItem[] => items.filter((i) => i.remind)

/**
 * The follow-ups that are actually *due* — the panel is called "Follow-ups due".
 *
 * The date test is the load-bearing part. Without it a chase you filed for next
 * month counted as due today: it was rendered on the dashboard's rail in red,
 * added to the "N follow-ups are overdue" priority card, and reported by the
 * glance panel as work waiting on you. Nothing about it was true, and the only
 * way to clear it was to tick off a nudge you had not sent.
 *
 * `today` is passed in, like every other dated reading in this file. It used to
 * default to the fixtures' pinned October, which made the default the wrong
 * answer everywhere and the right answer nowhere — this module cannot know what
 * day it is, and `src/data` is not allowed to find out.
 */
export const followUpsOf = (items: TimelineItem[], today: string): TimelineItem[] =>
  items.filter((i) => i.kind === 'follow-up' && !i.completedOn && i.date <= today)
