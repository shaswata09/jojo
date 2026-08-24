/**
 * Every date jojo holds, as a calendar file.
 *
 * ## Why this exists at all
 *
 * jojo knows when things are due and has no way to tell you. There are no
 * notifications on either platform, so a deadline reaches the user only if they
 * happen to open the app that day — which is the one thing a tracker cannot
 * depend on. The calendar the user already gets alerts from is the fix that
 * needs no permission, no background task, no server and no account: hand it an
 * `.ics` and the reminder fires on their watch.
 *
 * ## What goes in that the app's own calendar leaves out
 *
 * `offer.respondBy` is a FIELD on an application, not a timeline item, so it has
 * never appeared on the Calendar page — the dashboard is the only screen that
 * shows it. It is also the most consequential date in a job search: the one with
 * an offer attached and a clock running. An export that left it out to match the
 * in-app calendar would be matching the wrong thing, so it is written here as a
 * deadline of its own.
 *
 * ## The constraints this file works under
 *
 * `kg/core` is pure TypeScript — no DOM, no Node, and no wall-clock reads, all
 * checked by `scripts/check-platform.mjs`. So the stamp every event needs comes
 * in as an argument, and the UTF-8 byte counting that line folding requires is
 * written out longhand rather than borrowed from `TextEncoder`, exactly as
 * `backup.ts` hand-rolls base64 for the same reason.
 *
 * ## Times are floating, deliberately
 *
 * A `TimelineItem` stores `startMins` as minutes from midnight with no timezone
 * anywhere in the record, because "the interview is at 2pm" is what the user
 * typed and what they meant. Written without a `Z` and without a `TZID`, RFC
 * 5545 calls that a floating time and every calendar reads it as local — which
 * keeps 2pm at 2pm when the user flies to the campus visit. Writing it as UTC
 * would silently move it.
 */

import { addDays } from './dates'
import type { Application, Instant, TimelineItem, TimelineKind } from './model'

/** What the calendar file is called when it lands in someone's downloads. */
export const ICS_FILENAME = 'jojo-dates.ics'
export const ICS_MIME = 'text/calendar'

/**
 * How each kind reads in a calendar that knows nothing about jojo.
 *
 * The kind leads the summary rather than sitting in the description, and that is
 * the one place this file rewrites the user's own words. The reason is the
 * alert: a notification shows the summary and nothing else, and "Rice —
 * Statistics" at 9am does not say what is due. One word in front fixes that, and
 * it is the word the app already labels the row with.
 */
const KIND_LABEL: Record<TimelineKind, string> = {
  deadline: 'Deadline',
  interview: 'Interview',
  visit: 'Visit',
  call: 'Call',
  prep: 'Prep',
  admin: 'Admin',
  'follow-up': 'Follow-up',
}

/** Minutes an event lasts when the record does not say. */
const DEFAULT_MINUTES = 60

/**
 * How long before the start the alarm fires.
 *
 * All-day events start at midnight, so fifteen hours before start is 09:00 the
 * previous morning — a working hour on the day before, which is when a deadline
 * is still actionable. A timed event gets the half hour anyone would set by
 * hand. One alarm each: a calendar the user owns is the right place to add more,
 * and an import that fires four times per event is an import they delete.
 */
const ALARM_ALL_DAY = '-PT15H'
const ALARM_TIMED = '-PT30M'

/* --- escaping and folding -------------------------------------------------- */

/**
 * RFC 5545 §3.3.11. Backslash, semicolon and comma are separators in the
 * grammar and a newline has to become the two characters `\n`.
 *
 * The order matters: backslashes first, or every escape added below gets escaped
 * again by the pass that was meant to run before it.
 */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
}

/** UTF-8 length of one code point, without a `TextEncoder` to ask. */
function byteLength(codePoint: number): number {
  if (codePoint < 0x80) return 1
  if (codePoint < 0x800) return 2
  if (codePoint < 0x10000) return 3
  return 4
}

/**
 * Content lines are folded at 75 OCTETS, not 75 characters — and the split may
 * not land inside a character.
 *
 * That distinction is the whole reason this is written out. Every title in the
 * seeded data uses an em dash, which is three bytes; a naive fold at 75
 * characters produces lines that are over the limit, and a naive fold at byte 75
 * can cut an em dash in half and hand the reader a calendar file with a
 * replacement character in the middle of an employer's name.
 */
function fold(line: string): string {
  const out: string[] = []
  let current = ''
  let bytes = 0
  // A continuation line starts with one space, which counts towards its 75.
  let limit = 75

  for (const ch of line) {
    const size = byteLength(ch.codePointAt(0) ?? 0)
    if (bytes + size > limit) {
      out.push(current)
      current = ''
      bytes = 1 // the leading space on the continuation
      limit = 75
    }
    current += ch
    bytes += size
  }
  out.push(current)
  return out.join('\r\n ')
}

const line = (name: string, value: string) => fold(`${name}:${value}`)

/* --- dates ----------------------------------------------------------------- */

const pad = (n: number, width = 2) => String(n).padStart(width, '0')

/** 'YYYY-MM-DD' to the DATE value '20260828'. */
const asDate = (iso: string) => iso.replace(/-/g, '')

/** 'YYYY-MM-DD' plus minutes-from-midnight to a floating DATE-TIME. */
function asDateTime(iso: string, minutes: number): string {
  // Minutes past the end of the day roll the date forward, so an evening event
  // with a long duration lands on the next morning rather than at hour 26.
  const days = Math.floor(minutes / 1440)
  const rest = minutes - days * 1440
  const day = days === 0 ? iso : addDays(iso, days)
  return `${asDate(day)}T${pad(Math.floor(rest / 60))}${pad(rest % 60)}00`
}

/**
 * An `Instant` as a UTC stamp: '2026-08-23T12:00:00.000Z' to '20260823T120000Z'.
 *
 * Kept as string surgery rather than a `Date` round trip, because `core` may not
 * construct one — and because an `Instant` is already normalised, so there is
 * nothing for a parser to decide.
 */
function asStamp(at: Instant): string {
  const cleaned = String(at).replace(/[-:]/g, '')
  const dot = cleaned.indexOf('.')
  return `${dot === -1 ? cleaned.replace(/Z$/, '') : cleaned.slice(0, dot)}Z`
}

/* --- events ---------------------------------------------------------------- */

/** One event, already flattened out of whichever record it came from. */
type Event = {
  uid: string
  summary: string
  /** 'YYYY-MM-DD'. */
  date: string
  allDay: boolean
  startMins?: number
  durationMins?: number
  description: string[]
  category: string
}

function eventLines(e: Event, stamp: string): string[] {
  const out = [
    'BEGIN:VEVENT',
    line('UID', e.uid),
    line('DTSTAMP', stamp),
    line('SUMMARY', escapeText(e.summary)),
  ]

  if (e.allDay) {
    out.push(line('DTSTART;VALUE=DATE', asDate(e.date)))
    // DTEND is exclusive, so a one-day event ends on the following day. Written
    // rather than left out: a DATE event with no DTEND is legal and several
    // calendars render it as a zero-length sliver.
    out.push(line('DTEND;VALUE=DATE', asDate(addDays(e.date, 1))))
  } else {
    const start = e.startMins ?? 0
    out.push(line('DTSTART', asDateTime(e.date, start)))
    out.push(line('DTEND', asDateTime(e.date, start + (e.durationMins ?? DEFAULT_MINUTES))))
  }

  const description = e.description.filter(Boolean).join('\n')
  if (description) out.push(line('DESCRIPTION', escapeText(description)))
  out.push(line('CATEGORIES', escapeText(e.category)))

  out.push(
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    line('DESCRIPTION', escapeText(e.summary)),
    line('TRIGGER', e.allDay ? ALARM_ALL_DAY : ALARM_TIMED),
    'END:VALARM',
    'END:VEVENT',
  )
  return out
}

/* --- the file -------------------------------------------------------------- */

export type CalendarInput = {
  items: readonly TimelineItem[]
  applications: readonly Application[]
  /** When the export was taken. Every event carries it as DTSTAMP. */
  at: Instant
}

/** How many events a given store would produce. For a button that says so. */
export function calendarSize(input: Omit<CalendarInput, 'at'>): number {
  return input.items.length + input.applications.filter((a) => a.offer !== undefined).length
}

/**
 * The whole store's dates as one iCalendar document.
 *
 * Everything is exported, including dates that have passed. A calendar is a
 * record of when things happened as much as a warning about what is coming, and
 * a rule that quietly dropped last month would be a rule the user has to learn
 * from its absence.
 */
export function buildCalendar(input: CalendarInput): string {
  const stamp = asStamp(input.at)
  const nameOf = new Map(input.applications.map((a) => [a.id, `${a.org} — ${a.role}`]))

  // Spread rather than assigned, because `exactOptionalPropertyTypes` is on:
  // an absent `startMins` and one set to `undefined` are different types here,
  // and only the first is what an all-day item means.
  const events: Event[] = input.items.map((item) => ({
    uid: `${item.id}@jojo.local`,
    summary: `${KIND_LABEL[item.kind]} · ${item.title}`,
    date: item.date,
    allDay: item.allDay,
    ...(item.startMins === undefined ? {} : { startMins: item.startMins }),
    ...(item.durationMins === undefined ? {} : { durationMins: item.durationMins }),
    description: [
      item.detail ?? '',
      item.note ?? '',
      item.applicationIds.length === 0
        ? ''
        : item.applicationIds
            .map((id) => nameOf.get(id) ?? '')
            .filter(Boolean)
            .join(', '),
    ],
    category: KIND_LABEL[item.kind],
  }))

  for (const a of input.applications) {
    if (!a.offer) continue
    events.push({
      uid: `${a.id}-offer@jojo.local`,
      summary: `Deadline · Reply to ${a.org}`,
      date: a.offer.respondBy,
      allDay: true,
      description: [
        `Offer from ${a.org} — ${a.role}.`,
        a.offer.comp ? `Package: ${a.offer.comp}` : '',
        'Accept or decline by this date.',
      ],
      category: 'Deadline',
    })
  }

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//jojo//job tracker//EN',
    'CALSCALE:GREGORIAN',
    line('X-WR-CALNAME', 'jojo'),
    ...events.flatMap((e) => eventLines(e, stamp)),
    'END:VCALENDAR',
  ]

  // CRLF between lines and a trailing one: RFC 5545 §3.1 requires both, and a
  // file without the last one is rejected by strict importers.
  return `${lines.join('\r\n')}\r\n`
}
