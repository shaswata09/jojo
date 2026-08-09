import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { DismissableLayer } from 'radix-ui/internal'
import { CircleAlertIcon, XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  TOAST_ACTION_DURATION_MS,
  TOAST_DURATION_MS,
  takeDeferredFocusReturn,
} from '@/lib/toast-context'
import type { Toast } from '@/lib/toast-context'
import { useMediaQuery } from '@/lib/use-media-query'
import { cn } from '@/lib/utils'

/** Long enough to read as leaving, short enough not to sit in the way. */
const EXIT_MS = 150

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

/**
 * The one persistent toast stack, bottom right.
 *
 * The <ol> is rendered whether or not anything is in it. A live region has to
 * exist in the document *before* content lands inside it — assistive tech
 * subscribes to the node, so a region created together with its first message
 * routinely announces nothing at all.
 *
 * One region means one politeness setting, so it tracks the loudest toast on
 * screen: anything at `danger` tone raises the whole stack to assertive.
 * Nesting a second region per toast is the alternative, and support for nested
 * live regions is poor enough that it reliably reads neither.
 */
export function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: readonly Toast[]
  onDismiss: (id: string) => void
}) {
  const reducedMotion = useMediaQuery(REDUCED_MOTION_QUERY)

  return (
    /**
     * A branch of every dismissable layer, not a sibling of them.
     *
     * The stack is portalled to the root and painted above the dialogs, so a
     * click on a toast reached Radix as an outside-press and dismissed whatever
     * was open underneath: saving from the full-screen Vault preview and then
     * pressing the toast's own Undo applied the undo AND collapsed the panel the
     * user was working in. Undo is the one control that must never also destroy
     * the surface it is undoing on.
     *
     * `Branch` registers this node in the module-level set every DismissableLayer
     * consults before it dismisses, so one registration covers dialogs, popovers
     * and menus alike — a toast is never "outside" any of them. It does not
     * touch Escape, which still closes the layer as before.
     */
    <DismissableLayer.Branch asChild>
      <ol
        data-slot="toast-viewport"
        aria-label="Notifications"
        aria-live={toasts.some((t) => t.tone === 'danger') ? 'assertive' : 'polite'}
        // Only the toast that arrived should be read, not the whole stack again.
        aria-atomic="false"
        // The container spans the corner even when empty, so it has to let
        // clicks through to whatever is underneath it.
        className="pointer-events-none fixed right-0 bottom-0 z-[100] flex w-full flex-col gap-2 p-3 sm:max-w-sm sm:p-4"
      >
        {toasts.map((toast) => (
          <ToastItem
            key={toast.id}
            toast={toast}
            onDismiss={onDismiss}
            reducedMotion={reducedMotion}
          />
        ))}
      </ol>
    </DismissableLayer.Branch>
  )
}

function ToastItem({
  toast,
  onDismiss,
  reducedMotion,
}: {
  toast: Toast
  onDismiss: (id: string) => void
  reducedMotion: boolean
}) {
  const { id, title, description, tone = 'default', action } = toast
  const [leaving, setLeaving] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const paused = hovered || focused

  const remainingRef = useRef(action ? TOAST_ACTION_DURATION_MS : TOAST_DURATION_MS)

  const itemRef = useRef<HTMLLIElement>(null)
  /** Where focus was when the toast arrived, so it can be handed back. */
  const returnToRef = useRef<HTMLElement | null>(null)
  /** Set while the focus landing on the action is ours rather than the user's. */
  const takingFocusRef = useRef(false)
  const tookFocusRef = useRef(false)

  /**
   * Move focus to the action on arrival.
   *
   * The stack is the last thing in the document, so Undo sat behind every
   * control on the page — a keyboard user could not reach it inside the eight
   * seconds it lives, which makes it not an undo. The cost is that focus leaves
   * whatever fired the write, so it is handed back when the toast goes.
   *
   * Not while a modal is up: the dialog's focus scope would pull focus straight
   * back out and the two would trade it every frame. A toast fired from inside
   * an open dialog stays where it is.
   */
  const actionRef = useCallback((node: HTMLButtonElement | null) => {
    if (!node || document.querySelector('[role=dialog][data-state=open]')) return
    const active = document.activeElement
    returnToRef.current = active instanceof HTMLElement && active !== document.body ? active : null
    takingFocusRef.current = true
    tookFocusRef.current = true
    node.focus()
  }, [])

  // Give focus back to whatever fired the write, but only if the user never
  // moved it — otherwise dismissing an old toast would yank them out of
  // whatever they had moved on to.
  //
  // A LAYOUT effect, and that is the difference between this running and not:
  // React tears the toast's DOM out during the mutation phase, so by the time a
  // passive cleanup asks whether this node still holds focus the answer is
  // always no — `document.activeElement` is already `<body>`. Layout cleanup
  // runs on a still-connected node, which is the only moment the question means
  // anything.
  useLayoutEffect(() => {
    const item = itemRef.current
    return () => {
      if (!tookFocusRef.current) return
      // Claimed whether or not it gets used: when a dialog closes in the same
      // commit that fires this toast, there was nothing left on screen to record
      // above — the trigger arrives here instead, a tick later. A deferral this
      // toast does not use is stale by the time the next one arrives.
      const deferred = takeDeferredFocusReturn()
      if (!item?.contains(document.activeElement)) return
      const back = returnToRef.current ?? deferred
      if (back?.isConnected) back.focus({ preventScroll: true })
    }
  }, [])

  // Runs down only while unpaused, and banks whatever is left on the way out.
  // Restarting the full duration after every hover would let a pointer resting
  // anywhere near the corner keep a toast alive indefinitely.
  useEffect(() => {
    if (paused || leaving) return
    const startedAt = Date.now()
    const timer = window.setTimeout(() => setLeaving(true), remainingRef.current)
    return () => {
      window.clearTimeout(timer)
      remainingRef.current -= Date.now() - startedAt
    }
  }, [paused, leaving])

  // Dismissal is staged so the exit animation has a chance to play before the
  // node leaves the tree. With reduced motion there is nothing to wait for.
  useEffect(() => {
    if (!leaving) return
    const timer = window.setTimeout(() => onDismiss(id), reducedMotion ? 0 : EXIT_MS)
    return () => window.clearTimeout(timer)
  }, [leaving, reducedMotion, onDismiss, id])

  const danger = tone === 'danger'

  return (
    <li
      ref={itemRef}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      // React's focus events bubble, so this pair reads as focus-within: a
      // keyboard user tabbing towards Undo holds the toast open rather than
      // watching it expire on the way.
      onFocus={() => {
        // The focus we placed ourselves is not a decision to stay, so it must
        // not pause the countdown — otherwise every write would leave a mouse
        // user with a toast parked in the corner until they clicked something.
        if (takingFocusRef.current) {
          takingFocusRef.current = false
          return
        }
        setFocused(true)
      }}
      onBlur={() => setFocused(false)}
      // Escape closes what has focus. Without it the only way off an
      // auto-focused toast is Tab, which walks into the dismiss button.
      onKeyDown={(event) => {
        if (event.key === 'Escape') setLeaving(true)
      }}
      className={cn(
        'pointer-events-auto flex items-start gap-2.5 rounded-xl p-3 pr-2 shadow-[var(--shadow-raised)] ring-1',
        danger ? 'bg-danger-soft ring-danger-border' : 'bg-popover ring-foreground/10',
        leaving
          ? 'animate-out duration-150 fade-out-0 slide-out-to-right-4'
          : 'animate-in duration-150 fade-in-0 slide-in-from-bottom-3',
      )}
    >
      {danger ? <CircleAlertIcon className="mt-px size-4 shrink-0 text-danger" /> : null}

      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-text-1">{title}</p>
        {description ? <p className="mt-0.5 text-xs text-text-2">{description}</p> : null}
        {action ? (
          <Button
            ref={actionRef}
            variant="outline"
            size="xs"
            className="mt-2"
            onClick={() => {
              action.onClick()
              setLeaving(true)
            }}
          >
            {action.label}
          </Button>
        ) : null}
      </div>

      <Button variant="ghost" size="icon-xs" className="shrink-0" onClick={() => setLeaving(true)}>
        <XIcon />
        {/* Named, because three stacked "Dismiss" buttons name nothing. */}
        <span className="sr-only">Dismiss — {title}</span>
      </Button>
    </li>
  )
}
