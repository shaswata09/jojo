/**
 * How much of the origin's quota is in use, or nothing, never a rejection.
 *
 * Extracted from `DocumentsPanel` for the reason `pick-backup.ts` was: the
 * defect is a missing `catch` on a fire-and-forget promise, and D20 rules out
 * mounting the panel to reach it.
 *
 * The panel called `navigator.storage.estimate()` raw. That promise REJECTS
 * with a `TypeError` wherever the document has an opaque origin — a sandboxed
 * iframe without `allow-same-origin`, a `data:` or `blob:` document — because
 * such an origin has no storage shelf to measure. The call was
 * `void navigator.storage?.estimate?.().then(...)` with no `catch`, and the
 * optional chaining does nothing about it: it guards a MISSING method, not a
 * rejecting one. So the rejection went past the panel to `main.tsx`'s
 * `unhandledrejection` listener, which writes a line to the crash log.
 *
 * On screen it changed nothing either way — the usage line is already omitted
 * when there is no figure — so the entire effect was a crash report blaming
 * jojo for a browser that had already said storage here is degraded, in exactly
 * the environment where the user is most likely to hit failures that ARE worth
 * reporting and would now be sharing the log with this one.
 *
 * `estimateStorage` in `kg/storage/probe.ts` is the same call with that
 * `catch`, and is what Diagnostics and `StorageBanner` were already using. This
 * is the third caller rather than a second implementation.
 */

import { estimateStorage } from '@/kg/storage/probe'

export type StorageUsage = { used: number; quota: number }

/**
 * Both numbers or `null`. `estimateStorage` reports each field separately
 * because "not reported" is not zero, and half a pair cannot be rendered as
 * "4.0 MB of ? used" — the panel drops the line instead of printing a figure it
 * would have had to invent the other half of.
 */
export async function readStorageUsage(): Promise<StorageUsage | null> {
  const estimate = await estimateStorage()
  if (estimate === null || estimate.usage === null || estimate.quota === null) return null
  return { used: estimate.usage, quota: estimate.quota }
}
