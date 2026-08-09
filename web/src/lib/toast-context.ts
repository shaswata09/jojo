import { createContext, useContext } from 'react'

export type ToastTone = 'default' | 'danger'

export type ToastAction = {
  label: string
  onClick: () => void
}

export type ToastOptions = {
  title: string
  description?: string
  /** `danger` also raises the live region to assertive — see ToastViewport. */
  tone?: ToastTone
  /** One affordance only. A toast with two choices is a dialog wearing a hat. */
  action?: ToastAction
}

export type Toast = ToastOptions & { id: string }

export type ToastContextValue = {
  /** Queues a toast and returns its id, so a caller can retire it early. */
  toast: (options: ToastOptions) => string
  dismiss: (id: string) => void
}

/**
 * Deliberately carries no toast list. Every component that fires a toast
 * subscribes here, and putting the list in the value would re-render all of
 * them each time any toast appeared or expired. The provider renders the
 * viewport itself and hands it the list as a prop instead, so this value is
 * built once and never changes identity.
 */
export const ToastContext = createContext<ToastContextValue | null>(null)

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>')
  return ctx
}

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
