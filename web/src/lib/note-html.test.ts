/**
 * Turning what the editor produced into what is stored, and back.
 *
 * Everything here is pure on purpose. The DOM half — reading properties off
 * elements — lives in `note-runs.ts` and cannot be tested, because web tests
 * run under `environment: 'node'` and D20 forbids jsdom. So the split is the
 * test strategy: that file makes no decisions, and every decision is here.
 */

import { describe, expect, it } from 'vitest'
import { cleanupText, htmlFromNote, noteFromRuns, sizeOf, toneOf, TONE_INK } from '@/lib/note-html'
import { LABEL_TONE_VALUES, MAX_NOTE_SPANS } from '@jojo/service/core/model'
import { runsOf } from '@jojo/service/core/note-format'
import type { RawRun } from '@/lib/note-html'

const plain = (text: string): RawRun => ({ text })

describe('what a size means', () => {
  it('reads both spellings the editor can produce', () => {
    // `styleWithCSS` is advisory: Chrome emits `<font size>` on some paths
    // regardless, and pasted markup carries either.
    expect(sizeOf('2')).toBe('small')
    expect(sizeOf('3')).toBeUndefined()
    expect(sizeOf('5')).toBe('large')
    expect(sizeOf('6')).toBe('huge')
    expect(sizeOf('small')).toBe('small')
    expect(sizeOf('medium')).toBeUndefined()
    expect(sizeOf('x-large')).toBe('large')
    expect(sizeOf('20px')).toBe('large')
  })

  it('says nothing for a size it cannot name', () => {
    expect(sizeOf(undefined)).toBeUndefined()
    expect(sizeOf('inherit')).toBeUndefined()
    expect(sizeOf('2.5rem')).toBeUndefined()
  })
})

describe('what a colour means', () => {
  it('resolves every ink in the palette, in the spelling the DOM returns', () => {
    for (const tone of LABEL_TONE_VALUES) {
      expect(toneOf(TONE_INK[tone]), tone).toBe(tone)
      // The browser rewrites the hex the moment it lands in a style attribute.
      const n = Number.parseInt(TONE_INK[tone].slice(1), 16)
      expect(toneOf(`rgb(${String((n >> 16) & 255)}, ${String((n >> 8) & 255)}, ${String(n & 255)})`)).toBe(tone)
    }
  })

  it('refuses a colour this app has no name for, rather than snapping to one', () => {
    // Storing a guess would store a lie, and the store holds names, not inks.
    expect(toneOf('#ff0000')).toBeUndefined()
    expect(toneOf('rgb(1, 2, 3)')).toBeUndefined()
    expect(toneOf('red')).toBeUndefined()
  })
})

describe('runs from the editor into what is stored', () => {
  it('keeps the text and finds no formatting in a plain note', () => {
    const out = noteFromRuns([plain('Chased the chair')])
    expect(out.text).toBe('Chased the chair')
    expect(out.format).toBeUndefined()
  })

  it('puts the span on the right characters', () => {
    const out = noteFromRuns([plain('Chased the '), { text: 'chair', bold: true }, plain(' today')])
    expect(out.text).toBe('Chased the chair today')
    expect(out.format).toEqual([{ start: 11, end: 16, bold: true }])
    expect(out.text.slice(11, 16)).toBe('chair')
  })

  it('coalesces neighbours that look the same and keeps ones that do not', () => {
    const same = noteFromRuns([{ text: 'ab', bold: true }, { text: 'cd', bold: true }])
    expect(same.format).toEqual([{ start: 0, end: 4, bold: true }])
    const different = noteFromRuns([{ text: 'ab', bold: true }, { text: 'cd', italic: true }])
    expect(different.format).toHaveLength(2)
  })

  /*
   * This used to assert that a colour with no name was DROPPED, and it was
   * right for as long as a stored colour had to be one of eight names. The
   * spectrum picker changed the rule rather than the reasoning: a colour that
   * parses is kept as a hex on the span, and only a colour that is not a colour
   * at all is dropped. What survives from the old test is the half that still
   * matters — the rest of the run is never lost with it, and the person is told
   * when something was.
   */
  it('keeps a colour it has no name for, as the colour it is', () => {
    const out = noteFromRuns([{ text: 'careful', bold: true, colour: '#ff00ff' }])
    expect(out.format).toEqual([{ start: 0, end: 7, bold: true, ink: '#ff00ff' }])
    expect(out.dropped.colour).toBe(0)
  })

  it('keeps it through the spelling the DOM hands back', () => {
    // The browser rewrites a hex into `rgb()` the moment it lands in a style
    // attribute, so this is what is actually read back off a coloured note.
    const out = noteFromRuns([{ text: 'careful', colour: 'rgb(255, 0, 255)' }])
    expect(out.format).toEqual([{ start: 0, end: 7, ink: '#ff00ff' }])
  })

  it('still drops one that is not a colour, and keeps the rest of the run', () => {
    // A CSS keyword, a `var()`, a translucent colour: nothing this app can
    // guarantee a contrast for. Bold survives it; the person is told.
    const out = noteFromRuns([{ text: 'careful', bold: true, colour: 'rebeccapurple' }])
    expect(out.format).toEqual([{ start: 0, end: 7, bold: true }])
    expect(out.dropped.colour).toBe(1)
  })

  it('prefers the name when the colour IS one of the eight', () => {
    // Otherwise every note written in Blue would store a hex that nothing else
    // in jojo can refer to, and recolouring the palette would stop moving them.
    const out = noteFromRuns([{ text: 'careful', colour: 'rgb(60, 146, 195)' }])
    expect(out.format).toEqual([{ start: 0, end: 7, colour: 'teal' }])
  })

  it('keeps offsets right across the whitespace cleanup', () => {
    // The cleanup DELETES characters, so a span measured before it would be
    // several characters off and one measured after would have nothing to
    // attach to.
    const out = noteFromRuns([plain('  one   \n\n\n\n'), { text: 'two', bold: true }, plain('  ')])
    expect(out.text).toBe('one\n\ntwo')
    expect(out.format).toEqual([{ start: 5, end: 8, bold: true }])
    expect(out.text.slice(5, 8)).toBe('two')
  })

  it('keeps offsets right across an emoji', () => {
    const out = noteFromRuns([plain('done 🎉 '), { text: 'now', bold: true }])
    expect(out.text.slice(out.format?.[0]?.start, out.format?.[0]?.end)).toBe('now')
  })

  it('does the same whitespace cleanup the snippet editor does', () => {
    /*
     * The pin. `note-html.ts` is a PORT of `rich-text.ts`'s final rewrites
     * rather than a call into it, and a quiet difference would mean a note
     * saving with different line breaks than a snippet.
     */
    for (const raw of ['  a  \n b ', 'a\n\n\n\n\nb', '   ', 'a \nb\n', 'a\n \n \nb']) {
      const expected = raw
        .replace(/[^\S\n]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
      expect(cleanupText(raw), JSON.stringify(raw)).toBe(expected)
      expect(noteFromRuns([plain(raw)]).text, JSON.stringify(raw)).toBe(expected)
    }
  })

  it('counts what it had to leave out past the cap', () => {
    const many: RawRun[] = []
    for (let i = 0; i < MAX_NOTE_SPANS + 5; i += 1) {
      many.push({ text: 'x', bold: true }, plain(' '))
    }
    const out = noteFromRuns(many)
    expect(out.dropped.overflow).toBeGreaterThan(0)
    expect(out.format?.length).toBeLessThanOrEqual(MAX_NOTE_SPANS)
  })
})

describe('the stored note back into the editor', () => {
  it('escapes the text, so nothing typed can become markup', () => {
    const html = htmlFromNote('a < b & c > d', undefined)
    expect(html).toContain('&lt;')
    expect(html).toContain('&amp;')
    expect(html).toContain('&gt;')
    expect(html).not.toContain('<b ')
  })

  it('emits only styles built from this app’s own tables', () => {
    const html = htmlFromNote('bold red', [
      { start: 0, end: 4, bold: true },
      { start: 5, end: 8, colour: 'red' },
    ])
    expect(html).toContain('font-weight: 700')
    expect(html).toContain(`color: ${TONE_INK.red}`)
    // No attribute but style, ever.
    expect(html).not.toMatch(/<span (?!style=)/)
  })

  it('keeps the lines apart', () => {
    expect(htmlFromNote('one\ntwo', undefined)).toBe('<p>one</p><p>two</p>')
    expect(htmlFromNote('', undefined)).toBe('<p><br></p>')
  })

  it('renders exactly the characters the note holds', () => {
    // The same completeness `runsOf` guarantees, checked at this end too.
    const text = 'Chased the chair about the start date'
    const format = [{ start: 11, end: 16, bold: true } as const]
    expect(runsOf(text, format).map((r) => r.text).join('')).toBe(text)
  })
})
