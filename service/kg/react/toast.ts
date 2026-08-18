/**
 * L4 — the toast PORT. What the graph layer needs a platform to be able to say.
 *
 * This lived in `src/lib/toast-context.ts`, and `kg/react` imported it from
 * there (`kg/react/kg.tsx` and `kg/react/use-tool.ts`). That module also holds
 * `deferFocusReturn`, whose parameter is an `HTMLElement`, and the CSS selector
 * a dialog matches the toast stack with — so the one layer that is supposed to
 * mount unchanged inside React Native depended, through a single import line, on
 * a module that cannot exist there. Nothing caught it: `check-layers.mjs` allows
 * `kg/react` to import `@/lib`, and `tsconfig.core.json` inherited
 * `"lib": ["ES2023", "DOM"]` from the app config, so `HTMLElement` resolved
 * without complaint at every point on the path.
 *
 * So the interface came down and the implementation stayed up. `ToastViewport`,
 * `deferFocusReturn` and `TOAST_STACK_SELECTOR` are still in `src/lib` — they are
 * a web adapter and are allowed to be — and `src/lib/toast-context.ts` re-exports
 * the names below so the 20-odd components that fire toasts keep one import path.
 *
 * Nothing here names a DOM type, and `tsconfig.react.json` compiles this
 * directory with `"lib": ["ES2023"]`, so putting one back is now a `tsc` error
 * rather than a promise. An RN renderer implements `ToastContextValue` over its
 * own snackbar and every hook in this directory works unchanged.
 */

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
