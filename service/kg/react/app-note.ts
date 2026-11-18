/**
 * The app's own conversation notes, in the language on screen.
 *
 * A note with `app: true` is stored in English, exactly as its producer wrote
 * it: the agent writes them, the model may read them, and stored data stays
 * English. The transcripts show them through `appNoteText`, which reads a
 * stored note back to its `appNote` key the way `domain.action` reads a stored
 * `lastAction` — and shows anything it does not recognise exactly as stored (a
 * note with a dynamic part, an older build's wording).
 *
 * This lives in `react` because it has to see both sides: the producers are in
 * `agent/` (and `core/model-thread.ts`), the catalog is core's, and core may
 * not import `agent/`. Recognition is by exact text, never by pattern: a
 * counted note is read back only when the number in it, put through its
 * producer, gives the stored text word for word.
 */

import { TRIM_MARKER } from '../core/model-thread'
import type { AppNoteKey, CountedAppNote, DomainText } from '../core/domain-text'
// From the leaf, never from the producers (`budget`, `history`, `round`,
// `exit`): this module is in the app's boot bundle, and importing a producer
// pulls the agent loop's internals in with it — see `agent/notes.ts`.
import {
  CUT_CALL_NOTE,
  CUT_REPLY_NOTE,
  TOOLS_OVERFLOW_NOTE,
  VERIFY_NOTE,
  stubbedNote,
  summarisedNote,
  trimNote,
} from '../agent/notes'
import type { VerifyReason } from '../agent/verify-gate'

/** The fixed-text notes, by their stored English. */
const FIXED: ReadonlyMap<string, AppNoteKey> = new Map<string, AppNoteKey>([
  [TRIM_MARKER.replies, 'trimmed.replies'],
  [TRIM_MARKER.messages, 'trimmed.messages'],
  [TOOLS_OVERFLOW_NOTE, 'toolsOverflow'],
  [CUT_CALL_NOTE, 'cutCall'],
  [CUT_REPLY_NOTE, 'cutReply'],
  ...(Object.entries(VERIFY_NOTE) as [VerifyReason, string][]).map(
    ([reason, text]) => [text, `verify.${reason}`] as [string, AppNoteKey],
  ),
])

/** The counted notes, each with the producer that writes it. */
const COUNTED: readonly (readonly [CountedAppNote, (n: number) => string])[] = [
  ['summarised', summarisedNote],
  ['leftOut', trimNote],
  ['stubbed', stubbedNote],
]

/** The stored note's key (and count, for a counted one), or `null` when it is not one of these. */
export function appNoteKey(stored: string): { key: AppNoteKey; count?: number } | null {
  const fixed = FIXED.get(stored)
  if (fixed !== undefined) return { key: fixed }
  const digits = /\d+/.exec(stored)
  if (digits === null) return null
  const count = Number(digits[0])
  const counted = COUNTED.find(([, write]) => write(count) === stored)
  return counted === undefined ? null : { key: counted[0], count }
}

/** A stored app note in the language on screen; anything unrecognised exactly as stored. */
export function appNoteText(stored: string, domain: DomainText): string {
  const found = appNoteKey(stored)
  return found === null ? stored : domain.appNote(found.key, found.count)
}
