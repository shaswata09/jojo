/**
 * When a dock window takes the caret.
 *
 * It used to on every mount with the window open, which included a reload
 * that restored an open window and every return from the Assistant page (the
 * dock unmounts there). Both pulled focus out of whatever the person was doing
 * on the page beneath. A window takes the caret only as the answer to
 * something they did to the dock: opening it out, switching which conversation
 * it shows, or — on mount — when the dock has been used since it mounted.
 */

export type FocusMoment = {
  /** The window is expanded now. */
  open: boolean
  /** What it was at the previous check; `null` on the first one, at mount. */
  wasOpen: boolean | null
  /** The conversation it shows now, and at the previous check. */
  showing: string
  wasShowing: string | null
  /** The person has opened, picked or toggled something in the dock since it mounted. */
  dockUsed: boolean
}

export function shouldTakeFocus(m: FocusMoment): boolean {
  if (!m.open) return false
  if (m.wasOpen === null) return m.dockUsed
  if (!m.wasOpen) return true
  // The compact and full-screen layouts reuse one window for whichever
  // conversation is in front, so a switch arrives as a new id, not a mount.
  return m.wasShowing !== m.showing && m.dockUsed
}
