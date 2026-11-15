/**
 * The two conversions a form's rich note field needs, and nothing else.
 *
 * A form holds a note the way the store does: the TEXT, which every list,
 * search box, export and the phone read as it always was, and the formatting
 * beside it as `encodeFormat`'s one-line string — the shape the tools take it
 * in. The editor in between speaks HTML. These turn one into the other, and
 * are pure so a node test can hold them (D20); the DOM walk that produces the
 * runs is `lib/note-runs.ts`.
 */

import { decodeFormat, encodeFormat } from '@jojo/service/core/note-format'
import { htmlFromNote, noteFromRuns } from '@/lib/note-html'
import type { RawRun } from '@/lib/note-html'

/**
 * The HTML the editor opens on, for a stored note and its encoded formatting.
 *
 * `format` absent or `''` is a plain note — every record saved before notes
 * could be formatted — and opens as exactly that text.
 */
export const noteHtml = (text: string, format: string | undefined): string =>
  htmlFromNote(text, decodeFormat(format))

/**
 * What the field hands its form after an edit: the text, and the formatting
 * encoded — `''` when there is none, which the tools read as "clear it" rather
 * than "keep what was there". The editor is the whole truth about the note once
 * someone has typed in it, so it always says.
 */
export function noteValue(runs: readonly RawRun[]): { text: string; format: string } {
  const { text, format } = noteFromRuns(runs)
  return { text, format: encodeFormat(format) ?? '' }
}
