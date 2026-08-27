import { afterEach, describe, expect, it, vi } from 'vitest'
import { readStorageUsage } from '@/components/settings/storage-usage'

afterEach(() => {
  vi.unstubAllGlobals()
})

/** Only `storage` matters here; `estimateStorage` reads nothing else off it. */
function withStorage(storage: unknown): void {
  vi.stubGlobal('navigator', { storage })
}

describe('readStorageUsage', () => {
  it('reports both figures when the browser gives both', async () => {
    withStorage({ estimate: () => Promise.resolve({ usage: 4_000, quota: 100_000 }) })
    await expect(readStorageUsage()).resolves.toEqual({ used: 4_000, quota: 100_000 })
  })

  /*
   * The finding. An opaque origin — a sandboxed iframe, a `data:` document —
   * has no storage shelf, so `estimate()` rejects with a `TypeError` rather
   * than answering. `DocumentsPanel` called it as `void ...then(...)` with no
   * `catch`, and the rejection landed on `main.tsx`'s `unhandledrejection`
   * listener as a crash-log entry — in the one environment where storage is
   * already known to be degraded and a real bug report would be worth more.
   *
   * `rejects` is not what is asserted: the point is that it RESOLVES.
   */
  it('resolves to null instead of rejecting in an opaque origin', async () => {
    withStorage({
      estimate: () => Promise.reject(new TypeError('The operation is insecure.')),
    })
    await expect(readStorageUsage()).resolves.toBeNull()
  })

  /*
   * Not the same as rejecting, and the panel used to conflate them: optional
   * chaining covered this arm and only this arm.
   */
  it('resolves to null when the browser has no Storage API at all', async () => {
    withStorage(undefined)
    await expect(readStorageUsage()).resolves.toBeNull()
  })

  /*
   * `usage` and `quota` are both optional in the spec, and a browser may report
   * one without the other. "4.0 MB of 0.0 MB" would be a lie about the quota,
   * so a partial answer is no answer.
   */
  it('drops a partial estimate rather than printing half of it', async () => {
    withStorage({ estimate: () => Promise.resolve({ usage: 4_000 }) })
    await expect(readStorageUsage()).resolves.toBeNull()
  })

  it('keeps a genuine zero, which is not the same as unreported', async () => {
    withStorage({ estimate: () => Promise.resolve({ usage: 0, quota: 100_000 }) })
    await expect(readStorageUsage()).resolves.toEqual({ used: 0, quota: 100_000 })
  })
})
