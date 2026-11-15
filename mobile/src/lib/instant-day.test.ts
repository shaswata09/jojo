/// <reference types="vite/client" />
/*
 * The reference above is load-bearing. `import.meta.glob` is a Vite feature and
 * mobile's tsconfig grants no `vite/client` types — web's does, which is why the
 * twin of this file needs no such line and this one does. Without it the phone's
 * `tsc --noEmit` fails on `Property 'glob' does not exist on type 'ImportMeta'`,
 * and the file is a test so the type error is the only symptom.
 */

/**
 * The calendar a row's date comes from, on the phone.
 *
 * `TODAY` here is the LOCAL day. An `Instant` is UTC, and `.slice(0, 10)` takes
 * the UTC day out of it — so `agoLabel(x.slice(0, 10), TODAY)` compares two days
 * drawn from two different calendars. Measured with the zone forced, on a thread
 * touched seconds earlier:
 *
 *     America/Chicago, 23:30 local   sliced 2026-10-13 vs TODAY 2026-10-12
 *                                    -> "Oct 13", a FUTURE date
 *     Asia/Tokyo,      00:30 local   sliced 2026-10-12 vs TODAY 2026-10-13
 *                                    -> "yesterday", a day that never happened
 *
 * ## Why this file is in `lib/` and globs outward
 *
 * The offending line is in `components/assistant/ThreadListSheet.tsx`, and
 * `vitest.config.mts` includes `src/kg`, `src/lib` and `src/theme` only — a test
 * next to the component would never run. Reading the sources as TEXT from here
 * is what makes the rule enforceable at all, and it costs nothing: D20 forbids
 * mounting, and nothing is mounted.
 *
 * ## Why a pattern and not the one file
 *
 * Web's `ThreadList.tsx` was repaired on its own and left two identical twins
 * behind — this one, and `vault/FileViewer.tsx`. The bug was a habit, so the
 * guard looks for the habit. Web has the same guard over its own tree; neither
 * app's glob can see the other's, which is why there are two.
 */

import { describe, expect, it } from 'vitest'
import { agoLabel } from '@jojo/service/core/dates'
import { dayOf } from '@jojo/service/core/project'

describe('mixing a UTC day with a local TODAY', () => {
  it('prints a future date west of UTC and a phantom yesterday east of it', () => {
    // Stated as plain strings so it runs identically in every zone, including
    // UTC where the two calendars are one and nothing could be observed.
    expect(agoLabel('2026-10-13', '2026-10-12')).toBe('Oct 13')
    expect(agoLabel('2026-10-12', '2026-10-13')).toBe('yesterday')
    expect(agoLabel('2026-10-12', '2026-10-12')).toBe('today')
  })

  it('says "today" about a thread touched seconds ago, in any zone', () => {
    const offsetMins = new Date(2026, 9, 12, 23, 30).getTimezoneOffset()
    const updatedAt = (
      offsetMins > 0 ? new Date(2026, 9, 12, 23, 30) : new Date(2026, 9, 13, 0, 30)
    ).toISOString()
    const TODAY = dayOf(updatedAt)
    expect(agoLabel(dayOf(updatedAt), TODAY)).toBe('today')
    if (offsetMins !== 0) expect(agoLabel(updatedAt.slice(0, 10), TODAY)).not.toBe('today')
  })
})

const sources = import.meta.glob('../{components,screens,sheets}/**/*.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const withoutComments = (code: string) =>
  code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

describe('every phone row that dates an instant against TODAY', () => {
  it('derives the day through dayOf and never by slicing the instant', () => {
    /*
     * The exact shape, not a bare `.slice(0, 10)`. Slicing an instant is fine
     * where what it is compared against is also a UTC day, and places do that
     * legitimately; what is never right is mixing the two calendars in one call.
     */
    const offenders = Object.entries(sources)
      .filter(([, code]) =>
        /agoLabel\(\s*[^)]*\.slice\(\s*0\s*,\s*10\s*\)[^)]*,\s*TODAY/.test(withoutComments(code)),
      )
      .map(([path]) => path)
    expect(offenders, offenders.join('\n')).toEqual([])
  })

  it('is looking at the files it thinks it is', () => {
    // Guards the guard. A glob that matched nothing — or that stopped reaching
    // out of `lib/` after a config change — would make the rule above vacuous.
    expect(Object.keys(sources).length).toBeGreaterThan(30)
    const sheet = Object.entries(sources).find(([p]) => p.endsWith('ThreadListSheet.tsx'))
    expect(sheet, 'ThreadListSheet.tsx is not in the glob').toBeDefined()
    expect(withoutComments(sheet![1])).toContain('agoLabel(dayOf(t.updatedAt), TODAY)')
  })
})

/*
 * -----------------------------------------------------------------------------
 * A second habit, guarded the same way and for the same reason
 * -----------------------------------------------------------------------------
 *
 * `ApplicationSheet.onSave` wrote an application's keywords with the wrapped key
 * and then called `removeRecord(record.id)` with the bare one, believing the two
 * named different records. `recordKey` unwraps both to the SAME node — see
 * `service/kg/react/use-keywords.test.ts` — so the sweep cleared what the line
 * above had just written, and every edit of an application silently dropped all
 * of its keywords behind a "Changes saved" toast.
 *
 * The identity is asserted at its source. This asserts the SHAPE, here, because
 * the write lives inside a ~200-line `onSave` that D20 forbids mounting: a
 * `setRecord(...)` followed by a `removeRecord(...)` on the same record, with
 * nothing between them, is the pattern that caused it and has no correct use.
 */
/*
 * Line-based, NOT a regex over the call's arguments.
 *
 * The first attempt was `/setRecord\([^)]*\)\s*\n\s*removeRecord\(/`, and it
 * was inert: the real call is `setRecord(refKey('app', record.id), keywords)`,
 * so `[^)]*` stopped at the `)` closing `refKey` and the pattern never reached
 * the comma. Mutation-testing caught it — re-inserting the exact deleted line
 * left the suite green. Matching whole lines sidesteps the nesting entirely.
 */
const setThenSweep = (code: string): boolean => {
  const lines = code.split('\n').map((l) => l.trim()).filter((l) => l !== '')
  return lines.some((line, i) => {
    const next = lines[i + 1] ?? ''
    if (!line.includes('setRecord(') || !next.includes('removeRecord(')) return false
    /*
     * `if (keywords.length > 0) setRecord(id, keywords)` / `else removeRecord(id)`
     * is the CORRECT shape and appears three times in TimelineItemSheet: exactly
     * one of the two runs, and clearing a record that has no keywords left is
     * the point. The first line-based version flagged all three. What has no
     * correct use is the UNCONDITIONAL pair — write, then sweep the same record
     * — which is what ApplicationSheet did.
     */
    return !next.startsWith('else') && !line.startsWith('if ')
  })
}

describe('writing a record`s keywords and then sweeping the same record', () => {
  it('does not happen in any sheet or screen', () => {
    const offenders = Object.entries(sources)
      .filter(([, code]) => setThenSweep(withoutComments(code)))
      .map(([path]) => path)
    expect(offenders, offenders.join('\n')).toEqual([])
  })

  it('would notice if it came back', () => {
    // Guards the guard, against exactly the inertness the first version had.
    expect(
      setThenSweep("setRecord(refKey('app', record.id), keywords)\nremoveRecord(record.id)"),
    ).toBe(true)
    expect(
      setThenSweep("setRecord(refKey('app', created.id), keywords)\nif (form.deadline) mint()"),
    ).toBe(false)
    // The if/else pair TimelineItemSheet uses three times, which is correct.
    expect(setThenSweep('if (keywords.length > 0) setRecord(id, keywords)\nelse removeRecord(id)')).toBe(
      false,
    )
  })
})

/*
 * -----------------------------------------------------------------------------
 * What the phone's copy may promise about Transfer
 * -----------------------------------------------------------------------------
 *
 * Transfer moves a whole store between this phone and a COMPUTER, in either
 * direction since 2026-11-15: the phone always listens, and to send, the
 * computer pulls. It does not go phone to phone, and it is not sync.
 *
 * So two kinds of copy are wrong, and both have shipped: copy that says the
 * phone cannot send ("Transfer only receives" — true until the pull existed),
 * and copy that promises "another device", which a reader takes to include a
 * second phone. Both live in components D20 forbids mounting, so the rule is
 * asserted over the source text.
 */
const MISLEADS_ABOUT_TRANSFER = [
  /transfer only receives/i,
  /transfer[^.]{0,40}\b(?:another|other) device\b/i,
  /cannot send one from here/i,
]

const COPY = import.meta.glob('../{components,screens,sheets,lib}/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

describe('what the phone tells the user about Transfer', () => {
  it('says it sends to a computer, never that it only receives or reaches another phone', () => {
    // A `.test.` file quotes the banned phrasings in order to assert they are
    // absent; the rule is about user-facing copy.
    const offenders = Object.entries(COPY)
      .filter(([path]) => !path.includes('.test.'))
      .filter(([, code]) => MISLEADS_ABOUT_TRANSFER.some((r) => r.test(withoutComments(code))))
      .map(([path]) => path)
    expect(offenders, offenders.join('\n')).toEqual([])
  })

  it('would notice each phrasing that was actually shipped', () => {
    const shipped = [
      'Nothing was copied. Use Transfer instead — it hands the whole store to another device.',
      'the clipboard is the only way out of this phone — Transfer only receives',
      'Transfer brings a copy IN from your computer; it cannot send one from here.',
    ]
    for (const line of shipped) {
      expect(MISLEADS_ABOUT_TRANSFER.some((r) => r.test(line)), line).toBe(true)
    }
    // And does not fire on the copy that replaced them.
    expect(
      MISLEADS_ABOUT_TRANSFER.some((r) =>
        r.test('Use Transfer to send everything to your computer over your local network'),
      ),
    ).toBe(false)
  })
})
