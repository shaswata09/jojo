import { createContext } from 'react'
import type { View } from 'react-native'

/**
 * Where the tour's targets are: a registry the marked controls write into and
 * the overlay reads from.
 *
 * Module scope rather than context, because the overlay is mounted beside the
 * navigator and the targets live inside its screens — two trees that share no
 * provider below the app root. It holds view handles and small strings, never
 * records: the tour reads where a control is and what it says, nothing more.
 */

/** Scrolls the screen a target sits in, by `dy` points. */
export type Scroller = { scrollBy: (dy: number) => void }

export type TourTargetEntry = {
  node: View | null
  /** A value the control reports — the view it shows, the tool picked. */
  state?: string
  /** The scrolling screen it is inside, if any. */
  scroller?: Scroller | null
}

const targets = new Map<string, TourTargetEntry>()

export function setTarget(id: string, entry: TourTargetEntry): void {
  targets.set(id, entry)
}

/** Removed only if it is still this node's: a remount registers before the old unmount runs. */
export function clearTarget(id: string, node: View | null): void {
  if (targets.get(id)?.node === node) targets.delete(id)
}

export function getTarget(id: string): TourTargetEntry | undefined {
  return targets.get(id)
}

/** The scrolling screen a `TourTarget` is inside — provided by `Screen`. */
export const TourScrollContext = createContext<Scroller | null>(null)
