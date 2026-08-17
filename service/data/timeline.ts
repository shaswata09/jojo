/**
 * One model for anything with a date on it, and the fixture rows that seed it.
 *
 * The same real-world event used to be typed five ways — `Deadline`,
 * `FollowUp`, `AgendaEvent`, `Reminder` and `CalendarEvent` — with no key
 * joining the copies, so ticking off "UT Austin statements" in the Vault could
 * never reach the calendar or the dashboard. Every row from those five arrays
 * is transcribed below exactly once, keyed to the application it belongs to.
 *
 * The date algebra that used to open this file — `isoOf`, `partsOf`, `addDays`,
 * `daysBetween`, `shortDate`, `agoLabel`, `whenLabel`, `timeLabel`,
 * `compareItems`, `bucketOf`, `followUpsOf` — now lives in `kg/core/dates.ts`
 * and is re-exported below, so no call site moved. It left because six modules
 * under `service/kg` imported it and only `repo/seed.ts` and `tools/memory.ts`
 * wanted the fixture: the service layer was reaching through the `@/data` alias
 * for `shortDate` and taking a 276-line demo dataset with it. See the header of
 * `kg/core/dates.ts` for the failure that makes the alias itself the problem.
 *
 * What stays here is what is genuinely a fact about the fixture: `SEED_TODAY`,
 * the day these rows were authored against, and `seedOffset`, the rebase that
 * carries the whole story forward to the real one.
 */

export type { TimelineItem, TimelineKind } from '../kg/core/model'
export type { TimelineBucket } from '../kg/core/dates'
export {
  addDays,
  agoLabel,
  bucketOf,
  compareItems,
  daysBetween,
  followUpsOf,
  isoOf,
  partsOf,
  shortDate,
  timeLabel,
  whenLabel,
} from '../kg/core/dates'

import type { TimelineItem } from '../kg/core/model'
import { daysBetween } from '../kg/core/dates'

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
