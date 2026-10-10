import { useSyncExternalStore } from 'react'

/**
 * Which application's sheet is open, and how much of the right edge it takes.
 *
 * Read by the chat dock, which docks to the right of the window and has to sit
 * BESIDE an open record rather than on top of it — and which also uses the
 * record as the subject of a new conversation. The sheet is a portal deep
 * under the applications route; the dock is in the shell. A module store
 * rather than a context because the two share no ancestor below the shell
 * that would not re-render the whole page on every pixel of a resize drag.
 *
 * `width` is MEASURED, not the sheet's preferred width: the sheet's CSS caps
 * it at the viewport less a gutter, so on a narrow window the number it keeps
 * and the space it takes differ, and the dock needs the second.
 */
export type SheetPresence = { applicationId: string | null; width: number }

const CLOSED: SheetPresence = { applicationId: null, width: 0 }

let current: SheetPresence = CLOSED
const listeners = new Set<() => void>()

const emit = () => {
  for (const listener of listeners) listener()
}

/** Called by the sheet as it opens, resizes and changes record. */
export function publishSheet(next: SheetPresence) {
  if (next.applicationId === current.applicationId && next.width === current.width) return
  current = next
  emit()
}

/** Called by the sheet as it closes. */
export function clearSheet() {
  if (current === CLOSED) return
  current = CLOSED
  emit()
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

const snapshot = () => current

export function useSheetPresence(): SheetPresence {
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}
