/**
 * The formatting on an application's note, as plain values. L1 core.
 *
 * The text is in `ApplicationProps.note` and the formatting is in
 * `noteFormat` — see that prop's comment for why the two are separate facts
 * rather than a value and a copy of it. This module is everything that keeps
 * the pair honest, and there is deliberately nowhere else that does.
 *
 * ## Three functions, three jobs
 *
 * `normaliseFormat` decides what a well-formed list of spans IS, and is total:
 * handed anything, it returns something storable. It runs on restored data,
 * where throwing would mean losing the application over a colour.
 *
 * `retextFormat` moves spans when the text under them changes. It is called
 * INSIDE the two tools that can write `note`, never by a caller, because the
 * one way this design rots is somebody adding a third write site and forgetting.
 *
 * `runsOf` partitions the note into runs covering EVERY character, styled or
 * not, so neither renderer does offset arithmetic and neither can drop a
 * character. It is the same division of labour `core/marks.ts` has with the two
 * `Marked` components, and the reason the six plain readers stay correct: the
 * runs and `note` are the same characters in the same order.
 */

import { LABEL_TONE_VALUES, NOTE_SIZES } from './model'
import type { Hex, LabelTone, NoteSize, NoteSpan } from './model'
import { normaliseHex } from './ink'
import { s } from './schema'

/**
 * One span's shape, shared by the validator and the tool that writes them.
 *
 * Declared once for the reason `stageDatesShape` is: two spellings of the same
 * record drift the first time either is extended, and this one decides what a
 * renderer is allowed to be handed. Note what is still NOT here — no CSS, no
 * URL, no free string of any kind. A colour is a name from a closed set, or six
 * hex digits that `s.hexColor` has already parsed and rewritten; anything else
 * is refused at this boundary rather than being made safe at each renderer.
 */
export const noteSpanShape = s.object({
  start: s.number({ min: 0, int: true, label: 'From' }),
  end: s.number({ min: 0, int: true, label: 'To' }),
  bold: s.optional(s.literal(true, { label: 'Bold' })),
  italic: s.optional(s.literal(true, { label: 'Italic' })),
  underline: s.optional(s.literal(true, { label: 'Underline' })),
  strike: s.optional(s.literal(true, { label: 'Strikethrough' })),
  colour: s.optional(s.enum(LABEL_TONE_VALUES, { label: 'Colour' })),
  ink: s.optional(s.hexColor({ label: 'Custom colour' })),
  size: s.optional(s.enum(NOTE_SIZES, { label: 'Size' })),
})

/** What a run of note text looks like. `undefined` everywhere is plain. */
export type NoteRun = {
  readonly text: string
  readonly bold?: true
  readonly italic?: true
  readonly underline?: true
  readonly strike?: true
  readonly colour?: LabelTone
  readonly ink?: Hex
  readonly size?: NoteSize
}

/** The styling half of a span, with the offsets taken off. */
type Style = Omit<NoteSpan, 'start' | 'end'>

const TONES: ReadonlySet<string> = new Set<string>(LABEL_TONE_VALUES)
const SIZES: ReadonlySet<string> = new Set<string>(NOTE_SIZES)

/** Rebuilt key by key, so nothing a caller invented rides into the store. */
const styleOf = (span: NoteSpan): Style => ({
  ...(span.bold === true ? { bold: true } : {}),
  ...(span.italic === true ? { italic: true } : {}),
  ...(span.underline === true ? { underline: true } : {}),
  ...(span.strike === true ? { strike: true } : {}),
  ...(span.colour !== undefined && TONES.has(span.colour) ? { colour: span.colour } : {}),
  /*
   * Re-parsed rather than trusted, exactly as the tone is re-checked against
   * the set beside it. This function runs on data coming back from a restore,
   * where the schema's guarantee is one process old; `normaliseHex` is the same
   * parser `s.hexColor` uses, so a value that would not validate cannot survive
   * a round trip through here either.
   */
  ...(span.ink !== undefined && normaliseHex(span.ink) !== null
    ? { ink: normaliseHex(span.ink)! }
    : {}),
  ...(span.size !== undefined && SIZES.has(span.size) ? { size: span.size } : {}),
})

const styled = (style: Style): boolean => Object.keys(style).length > 0

const sameStyle = (a: Style, b: Style): boolean =>
  a.bold === b.bold &&
  a.italic === b.italic &&
  a.underline === b.underline &&
  a.strike === b.strike &&
  a.colour === b.colour &&
  a.ink === b.ink &&
  a.size === b.size

/**
 * A boundary that would split a surrogate pair, moved outward.
 *
 * An emoji is two UTF-16 code units and `slice` between them yields a lone
 * surrogate — a replacement glyph on screen and, worse, a character that is no
 * longer the one the person typed. Starts move back and ends move forward, so
 * the pair is always whole inside whichever run claims it.
 */
const isLow = (text: string, at: number): boolean => {
  const code = text.charCodeAt(at)
  return code >= 0xdc00 && code <= 0xdfff
}
const snapStart = (text: string, at: number): number => (at > 0 && isLow(text, at) ? at - 1 : at)
const snapEnd = (text: string, at: number): number =>
  at < text.length && isLow(text, at) ? at + 1 : at

/**
 * The canonical form of a note's formatting: sorted, disjoint, non-empty,
 * inside the text, adjacent equals merged — or `undefined` when there is none.
 *
 * `undefined` and never `[]`, the rule `checklist` states one prop up: a note
 * that never carried formatting and one whose formatting was just cleared have
 * to be the same bytes, or a backup taken either side of that differs over
 * nothing.
 *
 * Overlap is RESOLVED rather than rejected — earlier spans win, later ones are
 * pushed past them — because this runs on data coming back from a restore. A
 * validator may refuse a malformed colour; this one has to hand back something
 * that renders.
 */
export function normaliseFormat(
  text: string,
  spans: readonly NoteSpan[] | undefined,
): NoteSpan[] | undefined {
  if (spans === undefined || spans.length === 0) return undefined

  const clean: NoteSpan[] = []
  for (const span of spans) {
    if (!Number.isInteger(span.start) || !Number.isInteger(span.end)) continue
    const style = styleOf(span)
    if (!styled(style)) continue
    const start = snapStart(text, Math.max(0, Math.min(span.start, text.length)))
    const end = snapEnd(text, Math.max(0, Math.min(span.end, text.length)))
    if (end <= start) continue
    clean.push({ start, end, ...style })
  }
  if (clean.length === 0) return undefined

  clean.sort((a, b) => (a.start !== b.start ? a.start - b.start : a.end - b.end))

  const disjoint: NoteSpan[] = []
  let cursor = 0
  for (const span of clean) {
    const start = snapStart(text, Math.max(span.start, cursor))
    if (span.end <= start) continue
    disjoint.push({ start, end: span.end, ...styleOf(span) })
    cursor = span.end
  }
  if (disjoint.length === 0) return undefined

  const merged: NoteSpan[] = []
  for (const span of disjoint) {
    const last = merged[merged.length - 1]
    if (last !== undefined && last.end === span.start && sameStyle(styleOf(last), styleOf(span))) {
      merged[merged.length - 1] = { ...last, end: span.end }
      continue
    }
    merged.push(span)
  }
  return merged
}

/** The longest common prefix of two strings, in code units. */
const commonPrefix = (a: string, b: string): number => {
  const limit = Math.min(a.length, b.length)
  let i = 0
  while (i < limit && a[i] === b[i]) i += 1
  return i
}

/** The longest common suffix, never reaching back past `floor` in either. */
const commonSuffix = (a: string, b: string, floor: number): number => {
  const limit = Math.min(a.length - floor, b.length - floor)
  let i = 0
  while (i < limit && a[a.length - 1 - i] === b[b.length - 1 - i]) i += 1
  return i
}

/**
 * Move the formatting when the text under it changes.
 *
 * A ONE-WINDOW diff, and that is worth saying out loud rather than discovering:
 * it finds the longest unchanged head and the longest unchanged tail, and calls
 * everything between them changed. Two edits far apart in the same commit
 * collapse into one window, and formatting between them is dropped even though
 * those characters did not move.
 *
 * That is the conservative direction. It loses formatting; it never puts
 * formatting on characters the person did not format. A word-level diff would
 * keep more and is a drop-in behind this signature if it is ever wanted.
 *
 * Spans wholly in the head keep their offsets, spans wholly in the tail shift
 * by the length delta, and a span straddling either boundary is truncated to
 * the part that did not change rather than moved — so bold never creeps onto a
 * word somebody just typed.
 */
export function retextFormat(
  before: string,
  after: string,
  spans: readonly NoteSpan[] | undefined,
): NoteSpan[] | undefined {
  if (spans === undefined || spans.length === 0) return undefined
  // The commonest call by a mile: the edit dialog sends `note` on every save,
  // and a stage move touches the record without touching the note.
  if (before === after) return normaliseFormat(after, spans)

  const head = commonPrefix(before, after)
  const tail = commonSuffix(before, after, head)
  const beforeTail = before.length - tail
  const delta = after.length - before.length

  const moved: NoteSpan[] = []
  for (const span of spans) {
    const style = styleOf(span)
    // The part of the span that sits in the unchanged head.
    const headEnd = Math.min(span.end, head)
    if (span.start < headEnd) moved.push({ start: span.start, end: headEnd, ...style })
    // The part that sits in the unchanged tail, shifted by the length change.
    const tailStart = Math.max(span.start, beforeTail)
    if (tailStart < span.end) {
      moved.push({ start: tailStart + delta, end: span.end + delta, ...style })
    }
    // Anything between the two windows changed, and is dropped.
  }
  return normaliseFormat(after, moved)
}

/**
 * The note as a complete list of runs — every character, styled or not.
 *
 * Complete is the invariant that makes the plain readers safe:
 * `runsOf(note, spans).map((r) => r.text).join('') === note`, always, whatever
 * the spans say. A renderer that walks these cannot drop a character, cannot
 * double one, and never does arithmetic of its own.
 *
 * Normalises on the way in rather than trusting its input, because it is also
 * the last thing standing between a restored inconsistency and the screen.
 */
export function runsOf(text: string, spans: readonly NoteSpan[] | undefined): NoteRun[] {
  if (text === '') return []
  const clean = normaliseFormat(text, spans)
  if (clean === undefined) return [{ text }]

  const runs: NoteRun[] = []
  let at = 0
  for (const span of clean) {
    if (span.start > at) runs.push({ text: text.slice(at, span.start) })
    runs.push({ text: text.slice(span.start, span.end), ...styleOf(span) })
    at = span.end
  }
  if (at < text.length) runs.push({ text: text.slice(at) })
  return runs
}

/* ------------------------------- the wire ------------------------------- */

/**
 * Formatting as ONE short string, for the tool that carries it.
 *
 * The store holds `NoteSpan[]`; this is only how the note editor hands spans to
 * `application.note.set`. It exists for a measured reason: the same spans as an
 * array of objects cost about 1,100 characters of JSON Schema, which every
 * model request carries forever — more than two average tools — for a parameter
 * no model should ever produce. As a string the field is a line, and the tool
 * description says plainly that it is the editor's.
 *
 * `start-end:flags:colour:size`, segments joined by `;`, the last two fields
 * empty when absent. Flags are any of `b i u s`.
 *
 *   0-6:b::            bold over the first six characters
 *   11-16::red:        red, nothing else
 *   20-25:bi::large    bold and italic, larger
 *   30-35::#e11d48:    a colour off the spectrum
 *
 * ONE slot for the colour, holding either a name from the palette or a hex —
 * rather than a fifth field that is empty in every note anybody writes in the
 * eight. `decodeFormat` tells them apart by asking the palette first, which is
 * also the precedence the span itself has: a name is a colour this app can
 * refer to elsewhere, and a hex is one only this note knows about.
 *
 * `decodeFormat` is TOTAL: anything it cannot read is dropped rather than
 * thrown, because it runs on input and the worst honest outcome is a note that
 * saves with less formatting than it had.
 */
const FLAG_OF: Readonly<Record<string, keyof Style>> = {
  b: 'bold',
  i: 'italic',
  u: 'underline',
  s: 'strike',
}

export function encodeFormat(spans: readonly NoteSpan[] | undefined): string | undefined {
  if (spans === undefined || spans.length === 0) return undefined
  const out = spans.map((span) => {
    const flags = (['b', 'i', 'u', 's'] as const)
      .filter((f) => span[FLAG_OF[f] as 'bold'] === true)
      .join('')
    // The hex wins, matching the span's own precedence. Neither value can
    // contain a ':' or a ';' — a tone is an enum and a hex is six digits — so
    // the segments cannot be broken by what goes in them.
    const colour = span.ink ?? span.colour ?? ''
    return `${String(span.start)}-${String(span.end)}:${flags}:${colour}:${span.size ?? ''}`
  })
  return out.join(';')
}

export function decodeFormat(wire: string | undefined): NoteSpan[] | undefined {
  if (wire === undefined || wire.trim() === '') return undefined
  const spans: NoteSpan[] = []
  for (const segment of wire.split(';')) {
    const parts = segment.split(':')
    const range = (parts[0] ?? '').split('-')
    const start = Number(range[0])
    const end = Number(range[1])
    if (!Number.isInteger(start) || !Number.isInteger(end)) continue
    const flags = parts[1] ?? ''
    const colour = (parts[2] ?? '').trim()
    const size = (parts[3] ?? '').trim()
    const style: Record<string, unknown> = {}
    for (const ch of flags) {
      const key = FLAG_OF[ch]
      if (key !== undefined) style[key] = true
    }
    /*
     * The palette first, then the spectrum. A value that is neither is dropped
     * — this runs on input, and the worst honest outcome is a note that comes
     * back with less formatting than it had rather than one that comes back
     * carrying a string nobody parsed.
     */
    if (colour !== '') {
      if (TONES.has(colour)) style['colour'] = colour
      else {
        const hex = normaliseHex(colour)
        if (hex !== null) style['ink'] = hex
      }
    }
    if (size !== '' && SIZES.has(size)) style['size'] = size
    spans.push({ start, end, ...style } as NoteSpan)
  }
  return spans.length === 0 ? undefined : spans
}

/** Whether a note carries any formatting worth drawing. */
export const hasFormat = (
  text: string,
  spans: readonly NoteSpan[] | undefined,
): boolean => normaliseFormat(text, spans) !== undefined
