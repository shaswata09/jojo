/**
 * L1 — the stored shape of a note's formatting. `core/note-format.ts` owns the
 * rules; this is only what goes on disk. Re-exported by `core/model.ts`.
 */

import type { Hex } from './ink'
import type { LabelTone } from './model-label'

/* ----------------------------- note formatting ---------------------------- */

/**
 * The sizes a note may be written in. Normal is the ABSENCE of a size.
 *
 * Names rather than the 1–7 scale `execCommand('fontSize')` speaks, because the
 * scale is an implementation detail of one browser API and this is stored on
 * somebody's record for years. The editor's four buttons map onto these three
 * plus normal.
 */
export const NOTE_SIZES = ['small', 'large', 'huge'] as const
export type NoteSize = (typeof NOTE_SIZES)[number]

/**
 * One formatted stretch of an application's note.
 *
 * Half-open `[start, end)` over the UTF-16 code units of `note`, which is the
 * unit JavaScript slices in — so a boundary is snapped outward past a surrogate
 * pair rather than splitting an emoji in half.
 *
 * The flags are `?: true` and never `boolean`, so formatting that is equal has
 * exactly ONE spelling on disk. D12 compares whole records, and `{ bold: false }`
 * beside `{}` would be two bytes for one meaning and an undo that looked like a
 * change.
 *
 * `colour` is a `LabelTone` NAME. `ink` is the same field for a colour off the
 * spectrum, and the pair works exactly as `Label.tone`/`Label.ink` does: the
 * name is the fallback, the hex wins when it is there.
 *
 * This comment used to end "never a hex", and the reasoning behind that line
 * is kept because it is right: nothing about a note's formatting may be a
 * string a renderer could be talked into interpreting. What changed is how
 * that is enforced. An enum is one way to guarantee a value is inert; a parser
 * that accepts '#rgb' and '#rrggbb' and refuses every other string is another,
 * and it is the one `s.hexColor` implements — at the tool boundary and again
 * on the way back from a backup, where a bad value is stripped rather than
 * rendered. Sixteen million possible values, all of them six hex digits, none
 * of them `url(...)`.
 */
export type NoteSpan = {
  readonly start: number
  readonly end: number
  readonly bold?: true
  readonly italic?: true
  readonly underline?: true
  readonly strike?: true
  readonly colour?: LabelTone
  /** A colour off the spectrum. Wins over `colour` when both are there. */
  readonly ink?: Hex
  readonly size?: NoteSize
}

/**
 * How much formatting one note may carry.
 *
 * Judgement rather than measurement. Two hundred runs is far past what anybody
 * writes by hand and is the point at which a pasted web page is being stored as
 * formatting rather than as a note.
 */
export const MAX_NOTE_SPANS = 200
