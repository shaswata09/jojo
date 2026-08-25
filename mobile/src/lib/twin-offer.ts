import AsyncStorage from '@react-native-async-storage/async-storage'
import { mergeOffered, parseOffered } from '@jojo/service/core/twin'

/**
 * Where the profile offer's memory is kept on this device.
 *
 * The phone's half of `web/src/lib/twin-offer.ts`. What counts as a valid
 * remembered set, and what happens to it when a document is asked about, are
 * both in `core/twin.ts` — the two apps must answer those identically, and the
 * failure direction in particular is not a decision worth making twice.
 *
 * WHY ASYNCSTORAGE AND NOT THE GRAPH. The same argument `lib/onboarding.ts`
 * makes here and the web file makes there: "this dialog has been shown about
 * this file" is not a record the user authored. In the graph it would appear in
 * the audit log as a write they did not make, ride along in a backup, cross to
 * the other device on Transfer, and be undoable. It is a device preference and
 * it sits beside the model settings.
 *
 * WHY THE READ IS ASYNC AND THE WEB'S IS NOT. AsyncStorage, and it is a real
 * difference rather than a style one: the banner cannot decide what to show on
 * its first render, so it holds the set as `null` until the read lands. `null`
 * is deliberately a third value rather than an empty array — defaulting to
 * empty would flash the offer at every returning user for one frame before the
 * read came back and dismissed it, which for a consent prompt is worse than a
 * frame of nothing.
 */
const KEY = 'jojo/profile/offered'

/** The ids already asked about. Empty for anything that does not parse. */
export async function offered(): Promise<readonly string[]> {
  try {
    return parseOffered(await AsyncStorage.getItem(KEY))
  } catch {
    // A device whose store is unreadable asks again, which is the direction
    // this whole feature fails in. See `parseOffered`.
    return []
  }
}

/** Records that these were asked about, whichever way they were answered. */
export async function markOffered(ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(mergeOffered(await offered(), ids)))
  } catch {
    // Nothing to do and nothing worth saying: the consequence is being asked
    // once more, and an error toast about storage would be the louder problem.
  }
}
