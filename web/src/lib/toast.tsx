import { useCallback, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ToastViewport } from '@/components/ui/toast'
import { TOAST_LIMIT, ToastContext } from '@/lib/toast-context'
import type { Toast, ToastOptions } from '@/lib/toast-context'

/**
 * Transient confirmations, and the undo that hangs off them.
 *
 * Lives at the app root because a toast outlives the thing that fired it — a
 * delete confirmed in a dialog has to keep its Undo on screen after the dialog,
 * and often after the route, has gone.
 *
 * Hand-rolled rather than built on Radix's Toast, which is available. Radix
 * announces through a hidden per-toast region and leaves its <ol> viewport as a
 * plain landmark; the stack here puts the live region on the list itself. On
 * top of that the queue, the cap and the duration policy would be ours either
 * way, which left the primitive supplying a swipe gesture and an F8 hotkey.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<readonly Toast[]>([])
  const lastId = useRef(0)

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const toast = useCallback((options: ToastOptions) => {
    const id = `toast-${(lastId.current += 1)}`
    // Newest last, so the stack grows upward out of the corner, and the slice
    // takes the tail — over the cap it is the oldest that goes.
    setToasts((prev) => [...prev, { ...options, id }].slice(-TOAST_LIMIT))
    return id
  }, [])

  // Both callbacks are stable, so this value never changes identity and firing
  // a toast never re-renders the components that can fire one.
  const value = useMemo(() => ({ toast, dismiss }), [toast, dismiss])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  )
}
