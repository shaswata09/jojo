/**
 * The text the Settings "Export as JSON" button puts on the clipboard.
 *
 * One function, extracted from `screens/SettingsScreen.tsx`, and the extraction
 * is the point: D20 bans mounting a component, so while this envelope was built
 * inside an `onPress` there was no way for any test in this repo to ask the
 * only question that matters about it — does `readBackup` accept what this
 * writes? For two releases the answer was no.
 *
 * It used to copy `exportJSON()`, the projections on their own. Put that string
 * through `core/backup.ts`'s `readBackup` — the SAME reader the Transfer screen
 * runs every arriving file through — and it comes back `backup/not-a-backup`,
 * "this is an older export that holds only the readable summary, not the data
 * needed to restore". The phone's one outbound route wrote a file the phone's
 * own restore refused, on the screen whose "Clear every record" confirmation
 * tells people to export first. `phone-backup.test.ts` now asserts the round
 * trip, so putting the projections back fails a test rather than a person.
 *
 * ## Why there are no document bytes in it
 *
 * A backup carries file contents as base64, and this route's ceiling is half of
 * Android's 1 MB Binder buffer (`lib/clipboard-export.ts`) — one PDF exceeds it
 * on its own. So the file rows travel and their bytes do not: a restore from
 * this file renders them as documents that are not on this device, which
 * `repo/restore.ts` documents as the state it deliberately fails into. Transfer
 * is the route that carries bytes and has no such cap, and the copy under the
 * button says so.
 */

import { buildBackup } from '@jojo/service/core/backup'
import type { StoredEdge, StoredNode } from '@jojo/service/core/model'

export type PhoneBackupInput = {
  /** From the injected clock, never `new Date()` — see `react/kg-context`. */
  exportedAt: string
  /**
   * The RAW rows. Projections are denormalised views and cannot be turned back
   * into nodes and edges without guessing; `core/backup.ts` opens with why.
   */
  nodes: readonly StoredNode[]
  edges: readonly StoredEdge[]
  /**
   * The human-readable half, already parsed out of `exportJSON()`.
   *
   * Taken from that function rather than rebuilt here on purpose: it is the one
   * spelling of what the readable summary contains, and a second projection
   * list on this side of the app is exactly the drift that left a wrong
   * sentence about keywords under the Export button.
   *
   * Measured on the demo store (92 nodes, 115 edges): the projections alone
   * were a 52 KiB clipboard parcel, the rows alone 163 KiB, both together
   * 219 KiB against the 512 KiB ceiling. If that ceiling ever becomes the
   * binding constraint this is the half to drop — the rows are what a restore
   * needs.
   */
  readable?: unknown
}

/** The exported text, pretty-printed as `exportJSON` has always been. */
export function buildPhoneBackup(input: PhoneBackupInput): string {
  return JSON.stringify(
    buildBackup({
      exportedAt: input.exportedAt,
      nodes: input.nodes,
      edges: input.edges,
      documents: [],
      ...(input.readable === undefined ? {} : { readable: input.readable }),
    }),
    null,
    2,
  )
}
