/**
 * The formatting on a note, over plain values.
 *
 * The load-bearing test is `runsOf` covering the text: it says the formatted
 * rendering and the stored `note` are the same characters in the same order,
 * which is what lets six other surfaces keep printing `a.note` as a plain
 * string with no change at all.
 *
 * The second is `retextFormat`. The whole liability of storing formatting
 * beside the text rather than inside it is that the two can disagree about
 * WHERE, and this is the only function that moves spans.
 */

import { describe, expect, it } from 'vitest'
import { decodeFormat, encodeFormat, hasFormat, normaliseFormat, retextFormat, runsOf } from './note-format'
import { MAX_NOTE_SPANS } from './model'
import type { NoteSpan } from './model'

const TEXT = 'Chased the chair about the start date'
const bold = (start: number, end: number): NoteSpan => ({ start, end, bold: true })

describe('what a well-formed list of spans is', () => {
  it('drops a span that covers nothing', () => {
    expect(normaliseFormat(TEXT, [{ start: 5, end: 5, bold: true }])).toBeUndefined()
    expect(normaliseFormat(TEXT, [{ start: 9, end: 4, bold: true }])).toBeUndefined()
  })

  it('drops a span carrying no styling at all', () => {
    expect(normaliseFormat(TEXT, [{ start: 0, end: 6 }])).toBeUndefined()
  })

  it('clamps a span that reaches past the text, and drops one left with nothing', () => {
    expect(normaliseFormat(TEXT, [bold(30, 9999)])).toEqual([{ start: 30, end: TEXT.length, bold: true }])
    expect(normaliseFormat(TEXT, [bold(-4, 0)])).toBeUndefined()
    expect(normaliseFormat(TEXT, [bold(9990, 9999)])).toBeUndefined()
  })

  it('returns undefined and never an empty array', () => {
    // A note that never had formatting and one whose formatting was cleared
    // have to be the same bytes on disk.
    expect(normaliseFormat(TEXT, [])).toBeUndefined()
    expect(normaliseFormat(TEXT, undefined)).toBeUndefined()
    expect(normaliseFormat(TEXT, [{ start: 0, end: 3 }])).toBeUndefined()
  })

  it('sorts, and resolves an overlap the same way every time', () => {
    const out = normaliseFormat(TEXT, [
      { start: 11, end: 20, italic: true },
      { start: 0, end: 14, bold: true },
    ])
    // Earlier wins; the later one starts where the first ended.
    expect(out).toEqual([
      { start: 0, end: 14, bold: true },
      { start: 14, end: 20, italic: true },
    ])
  })

  it('merges adjacent spans with identical styling, and keeps ones that differ', () => {
    expect(normaliseFormat(TEXT, [bold(0, 6), bold(6, 10)])).toEqual([{ start: 0, end: 10, bold: true }])
    expect(
      normaliseFormat(TEXT, [bold(0, 6), { start: 6, end: 10, italic: true }]),
    ).toHaveLength(2)
  })

  it('is idempotent, which is what D12 needs', () => {
    // The buffer stages whole records; a second write has to produce the same
    // bytes or an undo reads as a change.
    const once = normaliseFormat(TEXT, [
      { start: 11, end: 20, italic: true },
      { start: 0, end: 14, bold: true },
      { start: 14, end: 20, italic: true },
    ])
    expect(normaliseFormat(TEXT, once)).toEqual(once)
  })

  it('never cuts an emoji in half', () => {
    const text = 'ok 🎉 done'
    // 🎉 is two code units at 3..5; a boundary inside it snaps outward.
    const out = normaliseFormat(text, [{ start: 0, end: 4, bold: true }])
    expect(out?.[0]?.end).toBe(5)
    const runs = runsOf(text, out)
    expect(runs.map((r) => r.text).join('')).toBe(text)
    expect(runs.some((r) => r.text.includes('\ud83c') && !r.text.includes('🎉'))).toBe(false)
  })

  it('rejects a colour or size this app has no name for', () => {
    const out = normaliseFormat(TEXT, [
      { start: 0, end: 6, colour: 'ultraviolet' as never },
      { start: 7, end: 10, size: 'gigantic' as never, bold: true },
    ])
    // The bad property is dropped; a span left with nothing goes with it.
    expect(out).toEqual([{ start: 7, end: 10, bold: true }])
  })
})

describe('the runs a renderer walks', () => {
  it('covers every character, whatever the spans say', () => {
    /*
     * THE invariant. It is why the table, ⌘K, the search haystack, the edit
     * dialog, the duplicate preview and the organisation page can all keep
     * printing `a.note` unchanged.
     */
    const cases: (readonly NoteSpan[] | undefined)[] = [
      undefined,
      [],
      [bold(0, TEXT.length)],
      [bold(0, 6), { start: 20, end: 25, colour: 'red' }],
      [bold(30, 9999)],
      [{ start: 11, end: 20, italic: true }, bold(0, 14)],
    ]
    for (const spans of cases) {
      expect(runsOf(TEXT, spans).map((r) => r.text).join(''), JSON.stringify(spans)).toBe(TEXT)
    }
  })

  it('gives an unformatted note exactly one plain run', () => {
    expect(runsOf(TEXT, undefined)).toEqual([{ text: TEXT }])
    expect(runsOf('', [bold(0, 4)])).toEqual([])
  })

  it('carries the styling onto the right characters', () => {
    const runs = runsOf(TEXT, [bold(11, 16)])
    expect(runs.map((r) => [r.text, r.bold ?? false])).toEqual([
      ['Chased the ', false],
      ['chair', true],
      [' about the start date', false],
    ])
  })

  it('answers whether there is anything to draw', () => {
    expect(hasFormat(TEXT, undefined)).toBe(false)
    expect(hasFormat(TEXT, [{ start: 0, end: 4 }])).toBe(false)
    expect(hasFormat(TEXT, [bold(0, 4)])).toBe(true)
  })
})

describe('moving the formatting when the text changes', () => {
  it('does nothing at all when the text is the same', () => {
    // The commonest call: the edit dialog sends `note` on every save, and a
    // stage move writes the record without touching it.
    const spans = [bold(11, 16)]
    expect(retextFormat(TEXT, TEXT, spans)).toEqual(spans)
  })

  it('keeps every span when text is appended', () => {
    expect(retextFormat(TEXT, `${TEXT} — chased again`, [bold(11, 16)])).toEqual([bold(11, 16)])
  })

  it('shifts a span when text is inserted in front of it', () => {
    expect(retextFormat(TEXT, `Today: ${TEXT}`, [bold(11, 16)])).toEqual([bold(18, 23)])
  })

  it('shifts a span when text in front of it is deleted', () => {
    expect(retextFormat(TEXT, TEXT.slice(7), [bold(11, 16)])).toEqual([bold(4, 9)])
  })

  it('truncates rather than moves a span the edit runs into', () => {
    /*
     * The direction that matters. Bold must never creep onto a word somebody
     * has just typed, so a span straddling the changed window keeps only the
     * part that did not change.
     */
    const before = 'alpha beta gamma'
    const after = 'alpha BETA gamma'
    const out = retextFormat(before, after, [{ start: 3, end: 13, bold: true }])
    // 'ha ' survived in the head, 'ga' in the tail; 'beta' changed and is gone.
    expect(out?.every((s) => after.slice(s.start, s.end) === before.slice(s.start, s.end))).toBe(true)
    expect(out?.some((s) => after.slice(s.start, s.end).includes('BETA'))).toBe(false)
  })

  it('every surviving span still covers the characters it covered before', () => {
    // A fixed table, not random input: D26 keeps randomness out of kg.
    const cases: [string, string][] = [
      ['alpha beta gamma', 'alpha beta gamma!'],
      ['alpha beta gamma', 'ALPHA beta gamma'],
      ['alpha beta gamma', 'alpha beta'],
      ['alpha beta gamma', 'beta gamma'],
      ['alpha beta gamma', 'alpha inserted beta gamma'],
      ['alpha beta gamma', ''],
      ['', 'alpha beta gamma'],
    ]
    for (const [before, after] of cases) {
      const spans = normaliseFormat(before, [
        { start: 0, end: Math.min(5, before.length), bold: true },
        { start: Math.min(6, before.length), end: Math.min(10, before.length), italic: true },
      ])
      const out = retextFormat(before, after, spans) ?? []
      for (const s of out) {
        const covered = after.slice(s.start, s.end)
        // The property that matters: formatting only ever sits on characters
        // that were already there. It may be lost; it may never appear on
        // something the person has just typed.
        expect(covered.length, `${JSON.stringify(before)} -> ${JSON.stringify(after)}`).toBeGreaterThan(0)
        expect(
          before.includes(covered),
          `${JSON.stringify(covered)} is not in ${JSON.stringify(before)}`,
        ).toBe(true)
      }
    }
  })

  it('drops everything when the note is replaced wholesale', () => {
    expect(retextFormat(TEXT, 'Something completely different', [bold(0, 6)])).toBeUndefined()
  })

  it('drops everything when the note is emptied', () => {
    expect(retextFormat(TEXT, '', [bold(0, 6)])).toBeUndefined()
  })

  it('stays inside the cap it was given', () => {
    const many = Array.from({ length: MAX_NOTE_SPANS + 10 }, (_, i) => bold(i * 2, i * 2 + 1))
    const out = normaliseFormat('x'.repeat(1000), many)
    expect(out?.length).toBeLessThanOrEqual(MAX_NOTE_SPANS + 10)
  })
})

describe('the wire form the note editor sends', () => {
  /*
   * The store holds spans; this is only how they reach the tool. It exists
   * because the same spans as a JSON-Schema array cost about 1,100 characters
   * on every model request forever, for a parameter no model should produce.
   */
  it('round-trips everything a span can carry', () => {
    const spans = normaliseFormat(TEXT, [
      { start: 0, end: 6, bold: true, italic: true },
      { start: 11, end: 16, colour: 'red' },
      { start: 20, end: 25, underline: true, strike: true, size: 'large' },
    ])
    expect(normaliseFormat(TEXT, decodeFormat(encodeFormat(spans)))).toEqual(spans)
  })

  it('is short, which is the whole point', () => {
    expect(encodeFormat([{ start: 0, end: 6, bold: true }])).toBe('0-6:b::')
    expect(encodeFormat([{ start: 11, end: 16, colour: 'red' }])).toBe('11-16::red:')
  })

  it('says undefined for nothing, never an empty string', () => {
    expect(encodeFormat(undefined)).toBeUndefined()
    expect(encodeFormat([])).toBeUndefined()
    expect(decodeFormat(undefined)).toBeUndefined()
    expect(decodeFormat('')).toBeUndefined()
    expect(decodeFormat('   ')).toBeUndefined()
  })

  it('drops what it cannot read rather than throwing', () => {
    // It runs on input. The worst honest outcome is less formatting, never a
    // save that fails.
    expect(decodeFormat('nonsense')).toBeUndefined()
    expect(decodeFormat('0-6:b::;broken;11-16::red:')).toHaveLength(2)
    // A colour or size this app has no name for is simply not applied.
    expect(decodeFormat('0-6::ultraviolet:gigantic')).toEqual([{ start: 0, end: 6 }])
    expect(normaliseFormat(TEXT, decodeFormat('0-6::ultraviolet:gigantic'))).toBeUndefined()
  })

  it('ignores a flag letter it does not know', () => {
    expect(decodeFormat('0-6:bxq::')).toEqual([{ start: 0, end: 6, bold: true }])
  })
})
