import { describe, expect, it } from 'vitest'
import { buildCalendar, calendarSize } from './ics'
import type { Application, Instant, TimelineItem } from './model'

/**
 * The calendar file, checked against the parts a foreign importer is strict
 * about.
 *
 * Weighted towards the two things that are invisible until somebody's calendar
 * refuses the file or renders it wrong: the octet-counted line folding, and the
 * escaping. Both produce a document that looks correct in a terminal and is
 * broken in Google Calendar, which is the worst kind of bug to ship in an
 * export — the user finds out when the deadline does not arrive.
 */

const AT = '2026-08-23T12:00:00.000Z' as Instant

const item = (over: Partial<TimelineItem> = {}): TimelineItem =>
  ({
    id: 'tl:1',
    title: 'Rice — Statistics',
    date: '2026-09-12',
    allDay: true,
    kind: 'deadline',
    urgency: 'amber',
    applicationIds: [],
    ...over,
  }) as TimelineItem

const application = (over: Partial<Application> = {}): Application =>
  ({
    id: 'app:1',
    org: 'Baylor',
    role: 'CS',
    note: '',
    roleTag: 'Assistant Professor',
    stage: 'offer',
    lastAction: 'Offer received',
    daysAgo: 2,
    ...over,
  }) as Application

/** Undo RFC 5545 folding, which is how a reader gets the logical lines back. */
const unfold = (ics: string) => ics.replace(/\r\n /g, '').split('\r\n')

describe('buildCalendar', () => {
  it('writes a document an importer will recognise', () => {
    const ics = buildCalendar({ items: [item()], applications: [], at: AT })
    const lines = unfold(ics)
    expect(lines[0]).toBe('BEGIN:VCALENDAR')
    expect(lines).toContain('VERSION:2.0')
    expect(lines).toContain('CALSCALE:GREGORIAN')
    expect(lines.at(-2)).toBe('END:VCALENDAR')
    // §3.1: CRLF everywhere, including after the last line.
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true)
    expect(ics.includes('\n\n')).toBe(false)
  })

  it('gives an all-day event a DATE start and an exclusive end', () => {
    const lines = unfold(buildCalendar({ items: [item()], applications: [], at: AT }))
    expect(lines).toContain('DTSTART;VALUE=DATE:20260912')
    // The day AFTER, or a one-day deadline renders as a zero-length sliver.
    expect(lines).toContain('DTEND;VALUE=DATE:20260913')
  })

  it('writes a timed event as a floating local time, with no Z and no TZID', () => {
    // The record has no timezone in it. 2pm is what the user typed, and a `Z`
    // here would move it by however far they are from UTC.
    const lines = unfold(
      buildCalendar({
        items: [item({ allDay: false, startMins: 14 * 60, durationMins: 90, kind: 'interview' })],
        applications: [],
        at: AT,
      }),
    )
    expect(lines).toContain('DTSTART:20260912T140000')
    expect(lines).toContain('DTEND:20260912T153000')
    expect(lines.some((l) => /^DTSTART.*Z$/.test(l))).toBe(false)
    expect(lines.some((l) => l.includes('TZID'))).toBe(false)
  })

  it('rolls the date when a duration runs past midnight', () => {
    const lines = unfold(
      buildCalendar({
        items: [item({ allDay: false, startMins: 23 * 60, durationMins: 120 })],
        applications: [],
        at: AT,
      }),
    )
    expect(lines).toContain('DTSTART:20260912T230000')
    expect(lines).toContain('DTEND:20260913T010000')
  })

  it('defaults a timed event with no duration to an hour', () => {
    const lines = unfold(
      buildCalendar({
        items: [item({ allDay: false, startMins: 9 * 60 })],
        applications: [],
        at: AT,
      }),
    )
    expect(lines).toContain('DTEND:20260912T100000')
  })

  it('leads the summary with the kind, because that is all an alert shows', () => {
    const lines = unfold(buildCalendar({ items: [item()], applications: [], at: AT }))
    expect(lines).toContain('SUMMARY:Deadline · Rice — Statistics')
  })

  it('escapes the four characters the grammar reserves', () => {
    const lines = unfold(
      buildCalendar({
        items: [item({ title: 'a,b;c\\d', detail: 'one\ntwo' })],
        applications: [],
        at: AT,
      }),
    )
    expect(lines.find((l) => l.startsWith('SUMMARY:'))).toBe('SUMMARY:Deadline · a\\,b\\;c\\\\d')
    expect(lines.find((l) => l.startsWith('DESCRIPTION:'))).toContain('one\\ntwo')
  })

  it('escapes backslashes before the escapes it adds', () => {
    // A second pass over its own output would turn `\,` into `\\,`.
    const lines = unfold(
      buildCalendar({ items: [item({ title: '\\' })], applications: [], at: AT }),
    )
    expect(lines.find((l) => l.startsWith('SUMMARY:'))).toBe('SUMMARY:Deadline · \\\\')
  })

  it('folds every line to 75 octets without cutting a character in half', () => {
    // Em dashes are three bytes each and the seeded titles are full of them.
    const long = `Rice — ${'Statistics — Department of Mathematics — '.repeat(4)}tenure track`
    const ics = buildCalendar({ items: [item({ title: long })], applications: [], at: AT })

    for (const line of ics.split('\r\n')) {
      let bytes = 0
      for (const ch of line) {
        const cp = ch.codePointAt(0) ?? 0
        bytes += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4
      }
      expect(bytes).toBeLessThanOrEqual(75)
    }
    // And it still says what it said: no replacement characters, and unfolding
    // gives the title back whole.
    expect(ics).not.toContain('�')
    expect(unfold(ics).find((l) => l.startsWith('SUMMARY:'))).toBe(`SUMMARY:Deadline · ${long}`)
  })

  it('carries the detail, the note and which jobs it is about', () => {
    const lines = unfold(
      buildCalendar({
        items: [
          item({
            detail: 'Application deadline',
            note: 'statements unfinished',
            applicationIds: ['app:1'],
          }),
        ],
        applications: [application({ id: 'app:1', org: 'Rice', role: 'Statistics' })],
        at: AT,
      }),
    )
    const description = lines.find((l) => l.startsWith('DESCRIPTION:')) ?? ''
    expect(description).toContain('Application deadline')
    expect(description).toContain('statements unfinished')
    expect(description).toContain('Rice — Statistics')
  })

  it('names a linked job without a dangling dash when it has no role', () => {
    // A posting promoted from a bare URL ('jobs.rice.edu/postings/29411') arrives
    // with role blank, and this file interpolated 'org — role' by hand rather
    // than calling `displayName` — so the exported description read 'Rice — ',
    // punctuation promising a second half that is not there.
    const lines = unfold(
      buildCalendar({
        items: [item({ detail: 'Application deadline', applicationIds: ['app:1'] })],
        applications: [application({ id: 'app:1', org: 'Rice', role: '' })],
        at: AT,
      }),
    )
    const description = lines.find((l) => l.startsWith('DESCRIPTION:')) ?? ''
    expect(description).toContain('Rice')
    expect(description).not.toContain('Rice —')
  })

  it('exports the offer deadline, which the app’s own calendar never shows', () => {
    // `offer.respondBy` is a field on the application rather than a timeline
    // item, so it reaches no calendar page — and it is the date with a clock on
    // it. Leaving it out to match the in-app calendar would match the wrong thing.
    const lines = unfold(
      buildCalendar({
        items: [],
        applications: [
          application({ offer: { respondBy: '2026-09-26', comp: '$112k', note: '' } }),
        ],
        at: AT,
      }),
    )
    expect(lines).toContain('SUMMARY:Deadline · Reply to Baylor')
    expect(lines).toContain('DTSTART;VALUE=DATE:20260926')
    expect(lines.find((l) => l.startsWith('DESCRIPTION:'))).toContain('$112k')
  })

  it('writes the offer description without a dangling dash when the role is blank', () => {
    // Same bug as the linked-job name, second site: 'Offer from Rice — .' — a
    // dash and a full stop with nothing between them.
    const lines = unfold(
      buildCalendar({
        items: [],
        applications: [
          application({ org: 'Rice', role: '', offer: { respondBy: '2026-09-26', note: '' } }),
        ],
        at: AT,
      }),
    )
    const description = lines.find((l) => l.startsWith('DESCRIPTION:')) ?? ''
    expect(description).toContain('Offer from Rice.')
  })

  it('ignores an application with no offer on it', () => {
    const ics = buildCalendar({
      items: [],
      applications: [application({ stage: 'submitted' })],
      at: AT,
    })
    expect(ics).not.toContain('BEGIN:VEVENT')
  })

  it('gives every event an alarm, and an all-day one fires the morning before', () => {
    const allDay = unfold(buildCalendar({ items: [item()], applications: [], at: AT }))
    expect(allDay).toContain('BEGIN:VALARM')
    // Start is midnight, so fifteen hours earlier is 09:00 the previous day.
    expect(allDay).toContain('TRIGGER:-PT15H')

    const timed = unfold(
      buildCalendar({ items: [item({ allDay: false, startMins: 600 })], applications: [], at: AT }),
    )
    expect(timed).toContain('TRIGGER:-PT30M')
  })

  it('keeps a UID that survives a re-export, so a second import updates rather than duplicates', () => {
    const once = buildCalendar({ items: [item()], applications: [], at: AT })
    const again = buildCalendar({
      items: [item({ title: 'renamed' })],
      applications: [],
      at: '2027-01-01T00:00:00.000Z' as Instant,
    })
    expect(unfold(once)).toContain('UID:tl:1@jojo.local')
    expect(unfold(again)).toContain('UID:tl:1@jojo.local')
  })

  it('stamps every event with the instant it was handed', () => {
    const lines = unfold(buildCalendar({ items: [item()], applications: [], at: AT }))
    expect(lines).toContain('DTSTAMP:20260823T120000Z')
  })

  it('writes a valid, empty calendar rather than nothing', () => {
    const ics = buildCalendar({ items: [], applications: [], at: AT })
    expect(ics).toContain('BEGIN:VCALENDAR')
    expect(ics).not.toContain('BEGIN:VEVENT')
  })

  it('counts what a button would promise', () => {
    expect(
      calendarSize({
        items: [item(), item({ id: 'tl:2' })],
        applications: [
          application({ offer: { respondBy: '2026-09-26', note: '' } }),
          application({ id: 'app:2', stage: 'submitted' }),
        ],
      }),
    ).toBe(3)
  })
})
