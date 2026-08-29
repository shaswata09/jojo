/**
 * The day a conversation row is measured against, and the calendar it comes from.
 *
 * `TODAY` is the LOCAL day — `lib/today.ts` takes it through `dayOf` precisely so
 * it is one. `updatedAt` is an instant, and `.slice(0, 10)` takes the UTC day out
 * of it, so the row was comparing two days drawn from two different calendars.
 * Measured with the zone forced, on a conversation touched seconds earlier:
 *
 *     America/Chicago, 23:30 local   sliced 2026-10-13 vs TODAY 2026-10-12
 *                                    -> agoLabel's negative-gap branch -> "Oct 13"
 *     Asia/Tokyo,      00:30 local   sliced 2026-10-12 vs TODAY 2026-10-13
 *                                    -> "yesterday"
 *
 * A future date, and a day that never happened, on a row the reader had just
 * been typing into.
 *
 * The first two tests state that as plain strings, so they run identically in
 * every zone including UTC — the pairs above are what the two calendars hand
 * `agoLabel`, and nothing about the harm depends on where the machine is. The
 * third takes the same pair from a real instant, which is the half that can only
 * differ where the zone does.
 *
 * D20: no component is mounted. The rule is asserted directly and the source is
 * then read as TEXT to check the row applies it — the label is one JSX
 * expression, and extracting a one-line module to make it callable would hide
 * the thing being guarded rather than guard it.
 */

import { describe, expect, it } from 'vitest'
import { agoLabel } from '@jojo/service/core/dates'
import { dayOf } from '@jojo/service/core/project'

describe('the day a thread row compares against TODAY', () => {
  it('prints a FUTURE date when the UTC day is read west of UTC', () => {
    // 23:30 in Chicago: the instant's ISO string already says the 13th.
    expect(agoLabel('2026-10-13', '2026-10-12')).toBe('Oct 13')
    expect(agoLabel('2026-10-12', '2026-10-12')).toBe('today')
  })

  it('prints "yesterday" when the UTC day is read east of UTC', () => {
    // 00:30 in Tokyo: the instant's ISO string still says the 12th.
    expect(agoLabel('2026-10-12', '2026-10-13')).toBe('yesterday')
    expect(agoLabel('2026-10-13', '2026-10-13')).toBe('today')
  })

  it('says "today" about a conversation touched seconds ago, in any zone', () => {
    /*
     * The same pair, taken from a real instant this time. West of UTC that is a
     * late local evening and east of it an early local morning; AT UTC the two
     * calendars are one calendar and no test can separate them, which the guard
     * below says out loud rather than pretending otherwise.
     */
    const offsetMins = new Date(2026, 9, 12, 23, 30).getTimezoneOffset() // UTC − local
    const updatedAt = (
      offsetMins > 0 ? new Date(2026, 9, 12, 23, 30) : new Date(2026, 9, 13, 0, 30)
    ).toISOString()
    const TODAY = dayOf(updatedAt)

    expect(agoLabel(dayOf(updatedAt), TODAY)).toBe('today')
    if (offsetMins !== 0) {
      expect(updatedAt.slice(0, 10)).not.toBe(TODAY)
      expect(agoLabel(updatedAt.slice(0, 10), TODAY)).not.toBe('today')
    }
  })
})

/**
 * Every site that dates a row from an instant, as text — `?raw`, the way
 * `public-assets.test.ts` reads sources.
 *
 * The glob is a PATTERN and not the one file this started as, and that widening
 * is the point. `ThreadList.tsx` was fixed on its own, and two identical twins
 * were left behind: `vault/FileViewer.tsx` dating a capture, and the phone's
 * `ThreadListSheet.tsx`, which is the same row on the other platform. Each was
 * one `.slice(0, 10)` away from printing a future date. A guard aimed at one
 * file certifies one file; the bug was a HABIT, and the habit is what this now
 * looks for.
 */
const sources = import.meta.glob('/src/components/**/*.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const withoutComments = (code: string) =>
  code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

describe('every row that dates an instant against TODAY', () => {
  it('derives the day through dayOf and never by slicing the instant', () => {
    /*
     * `agoLabel(x.slice(0, 10), TODAY)` is the exact shape, not a bare
     * `.slice(0, 10)` — slicing an instant is fine when what it is compared
     * against is also a UTC day, and several places legitimately do that. What
     * is never right is mixing the two calendars in one call.
     */
    const offenders = Object.entries(sources)
      .filter(([, code]) => /agoLabel\(\s*[^)]*\.slice\(\s*0\s*,\s*10\s*\)[^)]*,\s*TODAY/.test(withoutComments(code)))
      .map(([path]) => path)
    expect(offenders, offenders.join('\n')).toEqual([])
  })

  it('is looking at the files it thinks it is', () => {
    // Guards the guard: a glob that matched nothing would make the assertion
    // above vacuous, and this file has already been a one-file guard once.
    expect(Object.keys(sources).length).toBeGreaterThan(50)
    expect(withoutComments(sources['/src/components/assistant/ThreadList.tsx'] ?? '')).toContain(
      'agoLabel(dayOf(t.updatedAt), TODAY)',
    )
  })
})
