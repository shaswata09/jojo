/**
 * L0 — what the browser will tell us about keeping what we write.
 *
 * R-6, and only R-6. Safari evicts an origin after seven days without a visit
 * and there is no API that prevents it — only `navigator.storage.persist()`,
 * which asks. So the honest report has three states and one of them is "I do
 * not know": a browser with no Storage API is not a browser that will delete
 * your data, and saying "Persistent storage: no" there would be a claim this
 * code cannot back up.
 *
 * THE PROBE THAT USED TO BE HERE IS GONE, AND SHOULD NOT COME BACK
 *
 * `probeGraphStorage()` opened a throwaway database at boot, wrote a row, read
 * it back and deleted it, so a browser that blocks storage announced itself
 * before the user typed anything. §2 of the architecture still lists this file
 * as "`isGraphStorageAvailable()`; the IDB sibling of `storage.ts`". It had zero
 * callers, including in its own tests, because `repo/boot.ts` ended up asking
 * the real database the same question: it opens the store it is about to use and
 * reads `storage/blocked` against `storage/unsupported` off the driver's own
 * failure code, then falls back to `bootStandIn`. That is strictly better than a
 * probe — it is the connection the app actually needs, so there is no gap
 * between "the probe passed" and "the open failed" — and a probe in front of it
 * is a second `open`, a second `deleteDatabase` and a 3-second worst-case
 * timeout on the critical path to first paint, for an answer boot already has.
 *
 * If a first-run pre-flight is ever wanted again, it belongs in `repo/boot.ts`
 * against the real database, not as a second open of a fake one.
 */

/* ------------------------------- persistence ------------------------------ */

/**
 * `null` everywhere means "this platform will not say", never "no".
 *
 * Settings renders this verbatim, and the difference matters: *"Persistent
 * storage: no. This browser may delete jojo's data after 7 days without a
 * visit."* is a warning the user should act on, and printing it on a browser
 * that simply has no Storage API would be inventing a threat. R-6's rule is not
 * to imply durability the platform does not give — the same rule forbids
 * implying a danger it has not reported.
 */
export async function isStoragePersisted(): Promise<boolean | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.persisted) return null
  try {
    return await navigator.storage.persisted()
  } catch {
    return null
  }
}

/**
 * Asks the browser not to evict us. Called after the user's FIRST real record.
 *
 * Not at boot, and the timing is the whole point. Chrome grants or denies this
 * on heuristics — bookmarked, installed, engaged — and Firefox shows a
 * permission prompt. An unprompted request on a first visit, before the user has
 * typed anything, is the one most likely to be denied outright, and a denial is
 * remembered. Asking once they have something to lose is asking when the answer
 * is most likely to be yes and most likely to be understood.
 */
export async function requestPersistentStorage(): Promise<boolean | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) return null
  try {
    return await navigator.storage.persist()
  } catch {
    return null
  }
}

export type StorageEstimate = { usage: number | null; quota: number | null }

/** Settings' Diagnostics panel. `null` fields are "not reported", not zero. */
export async function estimateStorage(): Promise<StorageEstimate | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return null
  try {
    const estimate = await navigator.storage.estimate()
    return { usage: estimate.usage ?? null, quota: estimate.quota ?? null }
  } catch {
    return null
  }
}
