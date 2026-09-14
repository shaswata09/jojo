/**
 * Between the note editor's HTML and the formatting that is stored.
 *
 * Split from `note-runs.ts` along one line: everything here is PURE and tested,
 * everything there needs a DOM and cannot be. Web tests run under
 * `environment: 'node'` and D20 forbids jsdom, so the rule is that the DOM half
 * reads properties off elements and makes no decisions, and every decision —
 * what a size means, which colours exist, how offsets survive the whitespace
 * cleanup, what is dropped — lives here where a test can reach it.
 *
 * `rich-text.ts` is deliberately untouched. Three shipped features depend on
 * `textFromHtml`'s exact output, the DOM half of it cannot be tested, and a
 * change there would show up as a snippet coming back with its paragraph breaks
 * somewhere else. Two walkers that never have to agree on anything is the
 * cheaper risk, and `cleanupText` below is pinned to the same three rewrites.
 */

import { LABEL_TONE_VALUES } from '@jojo/service/core/model'
import type { LabelTone, NoteSize, NoteSpan } from '@jojo/service/core/model'
import { MAX_NOTE_SPANS } from '@jojo/service/core/model'
import { normaliseFormat, runsOf } from '@jojo/service/core/note-format'

/**
 * The toolbar's sizes, and the only mapping between `execCommand`'s 1–7 scale
 * and the names that are stored. Lives here rather than in the editor so the
 * button vocabulary and the storage vocabulary cannot drift.
 */
export const SIZES: readonly { value: string; label: string; size?: NoteSize }[] = [
  { value: '2', label: 'Small', size: 'small' },
  { value: '3', label: 'Normal' },
  { value: '5', label: 'Large', size: 'large' },
  { value: '6', label: 'Huge', size: 'huge' },
]

/**
 * The app's palette as the literal inks the toolbar writes into the markup.
 *
 * Moved here from `RichTextEditor.tsx` unchanged, so the swatches a person
 * picks from and the colours the store can name are one list. Adding a ninth
 * tone is a compile error until somebody picks its ink.
 */
export const TONE_INK: Record<LabelTone, string> = {
  gray: '#737373',
  teal: '#3c92c3',
  cyan: '#2f9bb0',
  green: '#449970',
  amber: '#aa842c',
  red: '#c96b64',
  pink: '#c77098',
  violet: '#8a6bbf',
}

const rgbOf = (hex: string): string => {
  const n = Number.parseInt(hex.slice(1), 16)
  return `rgb(${String((n >> 16) & 255)}, ${String((n >> 8) & 255)}, ${String(n & 255)})`
}

/**
 * Every ink, by what the DOM says when asked for it.
 *
 * The browser rewrites `#3c92c3` to `rgb(60, 146, 195)` the moment it lands in
 * a style attribute, so a lookup on the hex would never match. Exact only —
 * there is no nearest-neighbour snapping, because a colour that did not come
 * from this palette is not a colour this app has a name for, and guessing one
 * would store a lie.
 */
export const TONE_FROM_INK: ReadonlyMap<string, LabelTone> = new Map(
  LABEL_TONE_VALUES.flatMap((tone) => [
    [TONE_INK[tone].toLowerCase(), tone] as const,
    [rgbOf(TONE_INK[tone]), tone] as const,
  ]),
)

/** What the DOM half hands over: a stretch of text and what was on it. */
export type RawRun = {
  text: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strike?: boolean
  /** Whatever the element said, in whatever spelling. Resolved here. */
  colour?: string
  /** `<font size>` 1-7 or a CSS `font-size`. Resolved here. */
  size?: string
}

/** What could not be kept, so the person can be told rather than surprised. */
export type Dropped = { colour: number; size: number; overflow: number }

const SIZE_WORDS: Readonly<Record<string, NoteSize | undefined>> = {
  'x-small': 'small',
  small: 'small',
  medium: undefined,
  large: 'large',
  'x-large': 'large',
  'xx-large': 'huge',
}

/**
 * A size, from either spelling the editor can produce.
 *
 * `styleWithCSS` is advisory: Chrome is documented to emit `<font size="N">`
 * for `fontSize` on some paths regardless of it, and pasted markup can carry
 * either. Both are read, and anything else is no size at all.
 */
export function sizeOf(raw: string | undefined): NoteSize | undefined {
  if (raw === undefined) return undefined
  const value = raw.trim().toLowerCase()
  if (/^[1-7]$/.test(value)) {
    const n = Number(value)
    if (n <= 2) return 'small'
    if (n <= 4) return undefined
    if (n === 5) return 'large'
    return 'huge'
  }
  if (value in SIZE_WORDS) return SIZE_WORDS[value]
  const px = /^(\d+(?:\.\d+)?)px$/.exec(value)
  if (px) {
    const n = Number(px[1])
    if (n <= 12) return 'small'
    if (n <= 17) return undefined
    if (n <= 24) return 'large'
    return 'huge'
  }
  return undefined
}

/** A tone, or undefined for a colour this app has no name for. */
export const toneOf = (raw: string | undefined): LabelTone | undefined =>
  raw === undefined ? undefined : TONE_FROM_INK.get(raw.trim().toLowerCase())

/**
 * The three rewrites `textFromHtml` finishes with, kept identical.
 *
 * They are pinned by a test against the same regexes, because this is a port
 * rather than a shared call and a quiet difference here would mean a note
 * saving with different line breaks than a snippet does.
 */
export const cleanupText = (text: string): string =>
  text
    .replace(/[^\S\n]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

/**
 * Runs from the DOM → the text and the spans that are stored.
 *
 * Offsets are assigned in ONE pass over the joined text and then moved by the
 * same cleanup that produces the stored string, so an offset is only ever
 * attached to a character that survives. Computing them before the cleanup
 * would leave every span a few characters off; computing them after would leave
 * nothing to attach them to.
 */
export function noteFromRuns(runs: readonly RawRun[]): {
  text: string
  format: NoteSpan[] | undefined
  dropped: Dropped
} {
  const dropped: Dropped = { colour: 0, size: 0, overflow: 0 }

  // 1. The raw text, with each character's styling beside it.
  const chars: string[] = []
  const styles: (Omit<NoteSpan, 'start' | 'end'> | null)[] = []
  for (const run of runs) {
    const colour = toneOf(run.colour)
    if (run.colour !== undefined && colour === undefined) dropped.colour += 1
    const size = sizeOf(run.size)
    if (run.size !== undefined && size === undefined && run.size.trim() !== '3') dropped.size += 1
    const style = {
      ...(run.bold === true ? { bold: true as const } : {}),
      ...(run.italic === true ? { italic: true as const } : {}),
      ...(run.underline === true ? { underline: true as const } : {}),
      ...(run.strike === true ? { strike: true as const } : {}),
      ...(colour === undefined ? {} : { colour }),
      ...(size === undefined ? {} : { size }),
    }
    const has = Object.keys(style).length > 0
    /*
     * By CODE UNIT, not by code point. `for (const ch of text)` walks code
     * points, so an emoji counts once — and every span after one in the note
     * came out a character short, which is exactly the off-by-one a test with
     * an emoji in it caught. Offsets are code units because that is what
     * `slice` takes.
     */
    for (let i = 0; i < run.text.length; i += 1) {
      chars.push(run.text.charAt(i))
      styles.push(has ? style : null)
    }
  }

  // 2. The cleanup, applied to the pair so offsets follow the characters.
  const raw = chars.join('')
  const text = cleanupText(raw)
  const kept: (Omit<NoteSpan, 'start' | 'end'> | null)[] = []
  {
    // Walk the cleaned text and the raw text together. The cleanup only ever
    // DELETES characters, never reorders or inserts, so a two-pointer walk is
    // exact.
    let r = 0
    // Code units on both sides, for the reason above.
    for (let i = 0; i < text.length; i += 1) {
      const ch = text.charAt(i)
      while (r < chars.length && chars[r] !== ch) r += 1
      kept.push(styles[r] ?? null)
      r += 1
    }
  }

  // 3. Runs of identical styling become spans.
  const spans: NoteSpan[] = []
  let at = 0
  while (at < kept.length) {
    const style = kept[at]
    let end = at + 1
    while (end < kept.length && sameish(kept[end], style)) end += 1
    if (style !== null) spans.push({ start: at, end, ...style })
    at = end
  }

  if (spans.length > MAX_NOTE_SPANS) {
    dropped.overflow = spans.length - MAX_NOTE_SPANS
    spans.length = MAX_NOTE_SPANS
  }
  return { text, format: normaliseFormat(text, spans), dropped }
}

const sameish = (
  a: Omit<NoteSpan, 'start' | 'end'> | null,
  b: Omit<NoteSpan, 'start' | 'end'> | null,
): boolean => {
  if (a === null || b === null) return a === b
  return (
    a.bold === b.bold &&
    a.italic === b.italic &&
    a.underline === b.underline &&
    a.strike === b.strike &&
    a.colour === b.colour &&
    a.size === b.size
  )
}

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const FONT_SIZE: Readonly<Record<NoteSize, string>> = {
  small: '0.85em',
  large: '1.25em',
  huge: '1.6em',
}

/**
 * The stored note → the HTML the editor is loaded with.
 *
 * Pure, and it can be: building markup out of a closed set of enums needs no
 * DOM. Every character of the note is escaped, and the only attributes emitted
 * are a style built from this app's own tables — so nothing a person or a
 * backup put in the text can become markup.
 */
export function htmlFromNote(text: string, format: readonly NoteSpan[] | undefined): string {
  const runs = runsOf(text, format)
  if (runs.length === 0) return '<p><br></p>'

  // The paragraph structure the editor expects, rebuilt from the newlines.
  const lines: string[][] = [[]]
  for (const run of runs) {
    const parts = run.text.split('\n')
    parts.forEach((part, index) => {
      if (index > 0) lines.push([])
      if (part === '') return
      const style = [
        run.bold === true ? 'font-weight: 700' : '',
        run.italic === true ? 'font-style: italic' : '',
        run.underline === true || run.strike === true
          ? `text-decoration: ${[run.underline === true ? 'underline' : '', run.strike === true ? 'line-through' : ''].filter(Boolean).join(' ')}`
          : '',
        run.colour === undefined ? '' : `color: ${TONE_INK[run.colour]}`,
        run.size === undefined ? '' : `font-size: ${FONT_SIZE[run.size]}`,
      ]
        .filter(Boolean)
        .join('; ')
      const escaped = escapeHtml(part)
      lines[lines.length - 1]?.push(style === '' ? escaped : `<span style="${style}">${escaped}</span>`)
    })
  }
  return lines.map((parts) => (parts.length === 0 ? '<p><br></p>' : `<p>${parts.join('')}</p>`)).join('')
}
