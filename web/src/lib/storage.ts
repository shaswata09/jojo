/**
 * Guarded localStorage access.
 *
 * `localStorage` is a getter that THROWS rather than returning null when a
 * browser blocks storage — Safari private mode historically, embedded
 * webviews, and enterprise policies still do. An unguarded read at module
 * scope takes the whole app down before it renders.
 *
 * jojo is local-first, so storage is load-bearing rather than incidental:
 * `isStorageAvailable()` lets the UI say so instead of failing silently.
 */

export function isStorageAvailable(): boolean {
  try {
    const probe = '__jojo_probe__'
    window.localStorage.setItem(probe, probe)
    window.localStorage.removeItem(probe)
    return true
  } catch {
    return false
  }
}

export function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

/** Returns false when the write was rejected (blocked storage, quota exceeded). */
export function writeStored(key: string, value: string): boolean {
  try {
    window.localStorage.setItem(key, value)
    return true
  } catch {
    return false
  }
}

export function removeStored(key: string): boolean {
  try {
    window.localStorage.removeItem(key)
    return true
  } catch {
    return false
  }
}

/** What a wipe actually removed, so the confirmation can say something true. */
export type ClearedSiteData = {
  localStorage: number
  sessionStorage: number
  indexedDB: number
  caches: number
  cookies: number
  /** Set when the browser will not enumerate databases — see below. */
  indexedDBUnknown: boolean
}

/**
 * Removes everything this origin holds in the browser.
 *
 * Not just the two keys jojo writes today: the point of the control this backs
 * is "leave nothing behind", and a wipe that only knew about its own keys would
 * quietly skip a database left by an older build, a service-worker cache, or a
 * cookie set by something embedded. It enumerates each store and empties it.
 *
 * Every step is guarded separately. A browser that blocks storage throws on the
 * *getter* rather than returning empty, and one blocked store must not stop the
 * others being cleared — a partial wipe that reports honestly is much better
 * than an exception that leaves the user unsure what happened.
 *
 * Deliberately not a page reload, and the caller owns what happens next — which
 * matters more than it used to. This DOES reach the app's own records now: the
 * `indexedDB` step below deletes the database they live in, so after this
 * returns, every list still on screen is showing rows that exist nowhere and the
 * next edit would go to a closed store. `Settings.onClearStorage` reloads
 * immediately for exactly that reason; anything else calling this owes the same.
 */
/**
 * Caps a step that can hang.
 *
 * `indexedDB.databases()` and a `deleteDatabase` blocked by another tab can
 * both sit unresolved indefinitely, and everything after the await goes with
 * them — measured: local and session storage cleared, then cookies untouched
 * and no confirmation, with the button reading "Clearing…" for good. A step
 * that cannot finish has to be reported as unfinished rather than allowed to
 * take the rest of the wipe down with it.
 */
function withTimeout<T>(work: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([work, new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms))])
}

const STEP_TIMEOUT_MS = 2000

export async function clearSiteData(): Promise<ClearedSiteData> {
  const report: ClearedSiteData = {
    localStorage: 0,
    sessionStorage: 0,
    indexedDB: 0,
    caches: 0,
    cookies: 0,
    indexedDBUnknown: false,
  }

  try {
    report.localStorage = window.localStorage.length
    window.localStorage.clear()
  } catch {
    /* blocked — counted as nothing removed, which is the truth */
  }

  try {
    report.sessionStorage = window.sessionStorage.length
    window.sessionStorage.clear()
  } catch {
    /* as above */
  }

  // `indexedDB.databases()` is unimplemented in Firefox, where there is no way
  // to list databases at all. Reported as unknown rather than as zero: "no
  // databases" and "cannot see the databases" are different claims.
  try {
    if (typeof indexedDB !== 'undefined' && typeof indexedDB.databases === 'function') {
      const dbs = await withTimeout(indexedDB.databases(), STEP_TIMEOUT_MS, null)
      if (dbs === null) {
        report.indexedDBUnknown = true
      } else {
        await withTimeout(
          Promise.all(
            dbs.map(
              (db) =>
                new Promise<void>((resolve) => {
                  if (!db.name) return resolve()
                  const request = indexedDB.deleteDatabase(db.name)
                  // `blocked` fires when another tab holds the database open.
                  // It resolves rather than hanging: the delete is queued and
                  // completes when that tab closes.
                  request.onsuccess = request.onerror = request.onblocked = () => resolve()
                  report.indexedDB += 1
                }),
            ),
          ),
          STEP_TIMEOUT_MS,
          [],
        )
      }
    } else if (typeof indexedDB !== 'undefined') {
      report.indexedDBUnknown = true
    }
  } catch {
    report.indexedDBUnknown = true
  }

  try {
    if (typeof caches !== 'undefined') {
      const keys = await withTimeout(caches.keys(), STEP_TIMEOUT_MS, [])
      await withTimeout(Promise.all(keys.map((key) => caches.delete(key))), STEP_TIMEOUT_MS, [])
      report.caches = keys.length
    }
  } catch {
    /* Cache Storage is unavailable outside a secure context */
  }

  try {
    const jar = document.cookie ? document.cookie.split(';') : []
    for (const pair of jar) {
      const name = pair.split('=')[0]?.trim()
      if (!name) continue
      // Expired at the root path. A cookie set on a narrower path survives
      // this, which is why the count below is what was attempted rather than
      // what is provably gone.
      document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`
      report.cookies += 1
    }
  } catch {
    /* document.cookie throws in a sandboxed frame */
  }

  return report
}
