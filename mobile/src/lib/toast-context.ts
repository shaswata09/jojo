import { createContext, useContext } from 'react'

export type ToastTone = 'default' | 'danger'

export type ToastAction = {
  label: string
  onPress: () => void
}

export type ToastOptions = {
  title: string
  description?: string
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
 * Deliberately carries no toast list. Every screen that fires a toast
 * subscribes here, and putting the list in the value would re-render all of
 * them each time any toast appeared or expired.
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
 * Longer when there is something to press. Five seconds is enough to read a
 * confirmation but not to notice an Undo, decide, and reach it — and an undo
 * you cannot reach in time is not an undo.
 */
export const TOAST_ACTION_DURATION_MS = 8000
