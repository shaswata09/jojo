/**
 * L0 — is IndexedDB actually usable, and will the browser keep what we write?
 *
 * The IndexedDB sibling of `src/lib/storage.ts:13`, and it exists for the same
 * reason that one does: `localStorage` is a getter that THROWS rather than
 * returning null when a browser blocks storage, and IndexedDB is worse — the
 * global is present, `open()` returns a request, and the failure arrives
 * asynchronously as an error event some time later. A boot that finds out only
 * when the first save fails has already let the user type something they are
 * about to lose. A probe write at boot moves the honest failure to before they
 * did the work.
 *
 * Probing is a real open of a real database, not a feature test. Firefox in
 * private browsing exposes the whole API and rejects the open; a
 * `typeof indexedDB !== 'undefined'` check passes there and tells you nothing.
 *
 * R-6 lives here too. Safari evicts an origin after seven days without a visit,
 * and there is no API that prevents it — only `navigator.storage.persist()`,
 * which asks. So the honest report has three states and one of them is "I do not
 * know": a browser with no Storage API is not a browser that will delete your
 * data, and saying "Persistent storage: no" there would be a claim this code
 * cannot back up.
 */

/** The probe database. Deleted immediately; the name only shows up in devtools. */
const PROBE_DB = '__jojo_probe__'

/**
 * Long enough for a cold disk, short enough not to be the reason boot is slow.
 *
 * A blocked `open` never errors and never resolves — measured in `clearSiteData`
 * (storage.ts:78-87), where an unbounded step left a button reading "Clearing…"
 * for good. A probe that can hang is a boot that can hang, so it cannot.
 */
const PROBE_TIMEOUT_MS = 3_000

export type StorageAvailability =
  | { available: true }
  /**
   * 'unsupported' means there is no IndexedDB here at all — an old WebView, a
   * sandboxed frame. 'blocked' means there is one and it refused us: private
   * browsing, an enterprise policy, a cleared-cookies-on-exit setting. Kept
   * apart because only one of them is worth telling the user to change a
   * setting about.
   */
  | { available: false; reason: 'unsupported' | 'blocked'; detail: string }

function withTimeout<T>(work: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    work,
    new Promise<T>((resolve) => {
      setTimeout(() => resolve(fallback), ms)
    }),
  ])
}

/**
 * Opens a throwaway database, writes one row, reads it back, and deletes it.
 *
 * The read-back is not ceremony. A browser that accepts the open and silently
 * discards writes is the shape private-browsing quota failures actually take —
 * the write "succeeds" against a zero-byte quota and the row is gone — and an
 * open-only probe would report that store as healthy right up until the user's
 * first real save.
 */
export async function probeGraphStorage(): Promise<StorageAvailability> {
  if (typeof indexedDB === 'undefined') {
    return { available: false, reason: 'unsupported', detail: 'this runtime has no IndexedDB' }
  }

  const attempt = new Promise<StorageAvailability>((resolve) => {
    let request: IDBOpenDBRequest
    try {
      request = indexedDB.open(PROBE_DB, 1)
    } catch (e) {
      resolve({ available: false, reason: 'blocked', detail: describe(e) })
      return
    }

    request.onupgradeneeded = () => {
      request.result.createObjectStore('probe')
    }

    request.onerror = () => {
      resolve({ available: false, reason: 'blocked', detail: describe(request.error) })
    }

    // Fires when a previous probe database is still open somewhere. Nothing here
    // holds one, so this can only be a stale connection from a crashed tab —
    // reported as blocked rather than waited on, since the probe's whole job is
    // to answer quickly.
    request.onblocked = () => {
      resolve({ available: false, reason: 'blocked', detail: 'the probe database is locked' })
    }

    request.onsuccess = () => {
      const db = request.result
      try {
        const tx = db.transaction('probe', 'readwrite')
        const store = tx.objectStore('probe')
        store.put({ at: 'probe' }, 'probe')
        const readBack = store.get('probe')

        tx.oncomplete = () => {
          db.close()
          const value: unknown = readBack.result
          resolve(
            typeof value === 'object' && value !== null
              ? { available: true }
              : {
                  available: false,
                  reason: 'blocked',
                  detail: 'the write was accepted and then discarded',
                },
          )
        }
        tx.onerror = tx.onabort = () => {
          db.close()
          resolve({ available: false, reason: 'blocked', detail: describe(tx.error) })
        }
      } catch (e) {
        db.close()
        resolve({ available: false, reason: 'blocked', detail: describe(e) })
      }
    }
  })

  const result = await withTimeout<StorageAvailability>(attempt, PROBE_TIMEOUT_MS, {
    available: false,
    reason: 'blocked',
    detail: 'storage did not answer within 3 seconds',
  })

  // Deleted whatever the answer was, and not awaited. A leftover probe database
  // is harmless, and waiting on a delete in a runtime that just refused a write
  // is waiting on the same failure twice.
  try {
    indexedDB.deleteDatabase(PROBE_DB)
  } catch {
    /* nothing to clean up, and nothing to say about it */
  }

  return result
}

const describe = (e: unknown): string =>
  e instanceof Error ? `${e.name}: ${e.message}` : e === null ? 'no detail' : String(e)

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
