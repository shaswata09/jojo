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
