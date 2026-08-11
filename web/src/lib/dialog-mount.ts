/**
 * Which mount of a dialog is on screen, as a number that changes per open.
 *
 * `DialogHost` keyed its dialogs on what they were about — `application:new`,
 * `draft:<id>` — and that key is the same string for two consecutive opens of
 * the same thing. React reuses a mounted component when the key matches, and
 * both dialogs seed their fields with LAZY `useState` initialisers, so the
 * second open's `initial` was read once, at the first mount, and then never
 * again.
 *
 * The bug that made it visible: dismissing the new-application form fires
 * "Draft discarded · Undo brings the form back as you left it", and the toast
 * stack is deliberately painted above dialogs and stays clickable there. Open a
 * blank form first, then press that Undo, and the host re-opened the dialog with
 * the draft in `initial` while React kept the blank instance — same key, no
 * remount, empty fields, and the toast consumed. Editing an existing record is
 * the same path with `application:<id>` and behaved the same way.
 *
 * A per-open counter fixes it where it broke: two opens are two mounts, and the
 * lazy initialiser runs again because there is a new component to initialise.
 * Deliberately NOT a fresh key every render — that would remount the dialog on
 * every keystroke elsewhere in the tree and throw away what the user had typed,
 * which is why the counter advances on the identity of the open REQUEST rather
 * than on render.
 *
 * Kept out of `dialogs.tsx` so the rule is testable in node: `vitest.config.ts`
 * runs without a DOM and D20 forbids mounting components, so a rule that lived
 * inside the host could only ever have been checked by clicking — which is
 * exactly how this one got shipped.
 */

import type { OpenDialog } from '@/lib/dialogs-context'

export type DialogMount = {
  /**
   * The open request this mount was made for, by identity. `DialogsProvider`
   * mints a new object per `open()` call, and that is the only signal that
   * separates "opened again" from "re-rendered" — the name and props of a second
   * open are frequently identical to the first, which is the whole defect.
   */
  request: OpenDialog | null
  /** Advances once per open. Part of the key, so a new one means a new mount. */
  seq: number
}

/** Nothing open, nothing mounted. The host's initial state. */
export const NO_MOUNT: DialogMount = { request: null, seq: 0 }

/**
 * The mount that should be on screen, given the one that is.
 *
 * Returns the previous object unchanged when the request has not changed, so the
 * host's render-phase state update is a no-op on an ordinary re-render.
 */
export function nextMount(previous: DialogMount, current: OpenDialog | null): DialogMount {
  if (previous.request === current) return previous
  return { request: current, seq: previous.seq + 1 }
}

/**
 * The React key for a mount: what the dialog is about, plus which open it is.
 *
 * `identity` stays in the key rather than being replaced by the counter. It is
 * what makes a key legible in a component tree, and it keeps the guarantee the
 * host's original comment made — two different records can never share a mount —
 * true on its own terms rather than as a consequence of the counter.
 */
export const mountKey = (identity: string, mount: DialogMount): string => `${identity}#${mount.seq}`
