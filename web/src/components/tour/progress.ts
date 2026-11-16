import { readStored, removeStored, writeStored } from '@/lib/storage'

/** Where the reader got to. Deliberately not a record — see below. */
const PROGRESS_KEY = 'jojo.tour.step'

/**
 * Progress lives in localStorage, next to the theme and the sound switch, and
 * deliberately NOT in the graph.
 *
 * The store is the user's job search. "How far through a tutorial you are" is
 * not a thing they own, would show up in the audit log as a write they did not
 * make, would land in the export, and would be undoable with ⌘Z — which is
 * absurd for a bookmark. It is a browser preference, so it is stored like one,
 * through the guarded helpers: `localStorage` is a getter that THROWS in
 * blocked-storage browsers, and the tour must open in exactly those.
 *
 * The key stays private to this module and the three operations are named, so
 * the reasoning above sits with every read and write of it rather than with
 * only the read.
 */
export function readProgress(total: number): number {
  const raw = readStored(PROGRESS_KEY)
  if (raw === null) return 0
  const parsed = Number.parseInt(raw, 10)
  // A hand-edited or stale value must not strand the reader on a step that no
  // longer exists — steps get added and removed, the stored number does not.
  if (!Number.isFinite(parsed) || parsed < 0 || parsed >= total) return 0
  return parsed
}

export function writeProgress(step: number): void {
  writeStored(PROGRESS_KEY, String(step))
}

export function clearProgress(): void {
  removeStored(PROGRESS_KEY)
}
