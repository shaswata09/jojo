/**
 * The web adapter for the toast port, plus the one import path web code uses.
 *
 * The interface — `ToastOptions`, `ToastContextValue`, `ToastContext`,
 * `useToast` — lives in `@/kg/react/toast`, because `kg/react` fires toasts and
 * `kg/react` has to compile with no DOM lib at all. What is left here is
 * everything that only a browser can mean: an `HTMLElement` to hand focus back
 * to, and a CSS selector.
 *
 * The port is re-exported rather than re-imported at each call site so the 20-odd
 * components that fire toasts kept their import line when it moved. If you are
 * adding a helper below, ask which side of that split it is on: anything typed
 * in DOM terms belongs here and must not be imported from `src/kg`.
 */

export { ToastContext, useToast } from '@/kg/react/toast'
export type {
  Toast,
  ToastAction,
  ToastContextValue,
  ToastOptions,
  ToastTone,
} from '@/kg/react/toast'

/**
 * How many stay on screen; the oldest is dropped to make room. Saving a form
 * that touches several records fires a burst, and without a cap the column
 * grows until it covers the thing the user was looking at.
 */
export const TOAST_LIMIT = 3

export const TOAST_DURATION_MS = 5000

/**
 * Longer when there is something to click. Five seconds is enough to read a
 * confirmation, but not to notice an Undo, decide, and travel to it — and an
 * undo the user cannot reach in time is not an undo.
 */
export const TOAST_ACTION_DURATION_MS = 8000

/**
 * How an overlay recognises the toast stack.
 *
 * The stack is painted above every dialog and it can hold focus, because the
 * Undo lives in it. So a dialog must not read a click inside it as a click
 * *outside* the dialog, and a closing dialog must not take focus back off it.
 */
export const TOAST_STACK_SELECTOR = '[data-slot="toast-viewport"]'

/**
 * Where focus should land once the toast that took it has gone.
 *
 * An overlay that closes while firing a toast loses the race for focus: the
 * toast is already mounted and holding the Undo by the time the overlay's own
 * restore runs a tick later. Rather than yank focus off an Undo nobody has read
 * yet, the overlay leaves its trigger here and the toast passes it on.
 *
 * Module state rather than context, for the same reason the trigger origin is:
 * the toast that consumes this is not rendered by whatever set it.
 */
let deferredFocusReturn: HTMLElement | null = null

export function deferFocusReturn(element: HTMLElement | null) {
  deferredFocusReturn = element
}

/** Reads and clears — a deferral nobody used is stale, not a standing wish. */
export function takeDeferredFocusReturn(): HTMLElement | null {
  const element = deferredFocusReturn
  deferredFocusReturn = null
  return element
}
