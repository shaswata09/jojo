import { mergeOffered, parseOffered } from '@jojo/service/core/twin'
import { readStored, writeStored } from '@/lib/storage'

/**
 * Where the profile offer's memory is kept on this browser.
 *
 * The decision this file makes is the STORE, and nothing else: what counts as a
 * valid remembered set, and what happens to it when a document is asked about,
 * both live in `core/twin.ts` — because the phone has to answer those two
 * questions identically and would otherwise answer them again.
 *
 * WHY LOCALSTORAGE AND NOT THE GRAPH. The same argument `lib/onboarding.ts`
 * makes, and it applies with full force. "This dialog has been shown about this
 * file" is not a record the user authored: in the graph it would appear in the
 * audit log as a write they did not make, ride along in every backup, cross to
 * another machine on Transfer, and be undoable with ⌘Z. It is a browser
 * preference, so it lives where the theme lives — and through the guarded
 * helpers, because `localStorage` is a getter that throws in blocked-storage
 * browsers and an offer to read somebody's CV must not be what takes the app
 * down.
 *
 * A browser that refuses the write asks again next time. That is the direction
 * this whole feature fails in, and `parseOffered`'s header says why.
 */
const KEY = 'jojo.profile.offered'

/** The ids already asked about. Empty for anything that does not parse. */
export const offered = (): readonly string[] => parseOffered(readStored(KEY))

/** Records that these were asked about, whichever way they were answered. */
export function markOffered(ids: readonly string[]): void {
  if (ids.length === 0) return
  writeStored(KEY, JSON.stringify(mergeOffered(offered(), ids)))
}
