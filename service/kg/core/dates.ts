/**
 * L1 — the date algebra every dated surface in jojo reads through.
 *
 * It lived in `src/data/timeline.ts`, bolted to the 276-line seed array at the
 * bottom of that file, and it was the highest-fan-in module in the tree: 53 app
 * modules plus six under `kg` imported it, and two of those 59 wanted the
 * fixture. So `tools/application.ts` reached through the `@/data` alias for
 * `shortDate` and dragged a demo dataset into the layer that is supposed to be
 * shippable on its own.
 *
 * The move matters for one measured reason. `@/…` resolves against the
 * CONSUMER's project root, so when the Expo app imports this service layer,
 * `@/data/timeline` binds to `mobile/src/data/timeline.ts` — a copy that exists,
 * that differs, and that fails no check. A tool asking for `shortDate` would
 * silently get the other app's version. Nothing under `kg` should name a
 * module it does not ship, and after this move nothing does: `src/data` is read
 * by `repo/seed.ts` and `tools/memory.ts` and by nothing else in the layer.
 *
 * `src/data/timeline.ts` re-exports every name below, so the 53 app call sites
 * did not move and do not need to. It keeps the two things that really are
 * facts about the fixture — `SEED_TODAY` and `seedOffset`.
 *
 * No clock. Every function takes `today` as an argument, because this layer is
 * not allowed to find out what day it is (D26).
 */

import type { Offer, TimelineItem } from './model'

/** Which end of the day a row falls in. A reading of an item, not a field. */
export type TimelineBucket = 'overdue' | 'today' | 'upcoming' | 'done'

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
 * `todayISO()` used to sit beside these three and is deliberately gone.
 *
 * It read the wall clock from `src/data/timeline.ts`, the one directory `repo`
 * and `tools` were both allowed to import — so a tool could have reached the
 * clock through it without ever writing `new Date()`, which is the exact thing
 * D26 puts behind ToolContext.now. It had zero call sites in all of src/, so
 * nothing broke; what it had was a loaded gun inside an alias D26 protects.
 * Anything needing today's date takes it as an argument, the way `today` already
 * flows down from KgProvider. Here in `core` the ban is no longer a lint rule
 * about an alias: `check-platform.mjs` refuses `new Date()` and `Date.now()` in
 * this layer outright.
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

/**
 * Days until an offer must be answered. Negative once the date has passed, so
 * an expired offer reads as expired.
 *
 * `today` is required. It used to default to the fixtures' pinned day, and the
 * default was what every caller passed — so the countdown froze on the day the
 * fixtures were written and an offer whose deadline was last month still said
 * "in 34 days". A date this layer cannot know is a date this layer must be
 * handed.
 */
export function offerDaysLeft(offer: Offer, today: string): number {
  return daysBetween(today, offer.respondBy)
}
