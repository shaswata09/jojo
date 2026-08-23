import * as React from 'react'
import { Dialog as DialogPrimitive } from 'radix-ui'
import { XIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { triggerElement, triggerOrigin } from '@/lib/dialogs-context'
import { TOAST_STACK_SELECTOR, deferFocusReturn } from '@/lib/toast-context'
import { useMediaQuery } from '@/lib/use-media-query'
import { cn } from '@/lib/utils'

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

/** Reduced motion means a gentler equivalent, not nothing: the panel still
 *  arrives, it just arrives by fading instead of growing. */
const REDUCED_FADE_MS = 120

function Dialog({ ...props }: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({ ...props }: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({ ...props }: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({ ...props }: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

/**
 * Fades a node in with WAAPI.
 *
 * The app's global `prefers-reduced-motion` block flattens every CSS animation
 * and transition to 0.01ms with `!important`, so under that setting a CSS
 * cross-fade is not a gentler equivalent — it is no motion at all. A script
 * animation is the one thing that reset cannot reach.
 */
function fadeIn(node: HTMLElement) {
  node.animate([{ opacity: 0 }, { opacity: 1 }], { duration: REDUCED_FADE_MS, easing: 'ease-out' })
}

function DialogOverlay({
  className,
  ref,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  const reducedMotion = useMediaQuery(REDUCED_MOTION_QUERY)

  const setRef = React.useCallback(
    (node: HTMLDivElement | null) => {
      if (typeof ref === 'function') ref(node)
      else if (ref) ref.current = node
      if (node && reducedMotion) fadeIn(node)
    },
    [ref, reducedMotion],
  )

  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      ref={setRef}
      className={cn(
        'fixed inset-0 isolate z-50 bg-black/10 supports-backdrop-filter:backdrop-blur-xs',
        // The scrim is context, not the event — it settles while the panel is
        // still on its way in, and it is dropped from the reduced-motion path
        // because the CSS reset would only stutter it.
        !reducedMotion &&
          'duration-150 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0',
        className,
      )}
      {...props}
    />
  )
}

/**
 * Grows the panel out of the control that summoned it.
 *
 * `transform-origin` is measured in the element's own box, so the trigger point
 * has to be converted into it. Two traps: the rect is read mid-animation, so
 * only its *centre* is trustworthy (scaling about the default origin leaves the
 * centre where it is) and the layout size has to come from `offsetWidth` /
 * `offsetHeight`, which transforms do not touch. And the write has to happen in
 * the ref callback — that runs during the commit, before the browser paints the
 * first frame of the entrance, which is the last moment it can still count.
 */
function applyTransformOrigin(node: HTMLElement) {
  const origin = triggerOrigin()
  if (!origin) return

  const rect = node.getBoundingClientRect()
  const width = node.offsetWidth
  const height = node.offsetHeight
  if (width === 0 || height === 0) return

  const left = rect.left + rect.width / 2 - width / 2
  const top = rect.top + rect.height / 2 - height / 2
  const x = Math.min(Math.max(origin.x - left, 0), width)
  const y = Math.min(Math.max(origin.y - top, 0), height)

  node.style.transformOrigin = `${Math.round(x)}px ${Math.round(y)}px`
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  onCloseAutoFocus,
  ref,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean
}) {
  const reducedMotion = useMediaQuery(REDUCED_MOTION_QUERY)

  /**
   * The control this dialog was summoned from, kept so it can be handed focus
   * back when the dialog goes.
   *
   * Radix's own restore focuses `DialogTrigger`, and almost nothing here uses
   * one — the create dialogs are mounted by name from `DialogHost`, the
   * full-screen panels and the confirmations own their `open` flag. With an
   * empty trigger ref that restore focuses nothing at all, so closing any
   * overlay dropped the user on `<body>`: back above the skip link, the mascot
   * and the whole sidebar, a Tab journey away from where they had been.
   *
   * `??=` rather than a plain assignment: `setRef` is re-created when the
   * reduced-motion query changes identity, and React detaches then re-attaches
   * on that — the second run would capture something inside the dialog itself.
   */
  const returnFocusRef = React.useRef<HTMLElement | null>(null)

  const setRef = React.useCallback(
    (node: HTMLDivElement | null) => {
      if (typeof ref === 'function') ref(node)
      else if (ref) ref.current = node
      if (!node) return
      returnFocusRef.current ??= triggerElement()
      if (reducedMotion) fadeIn(node)
      else applyTransformOrigin(node)
    },
    [ref, reducedMotion],
  )

  const handleCloseAutoFocus = React.useCallback(
    (event: Event) => {
      onCloseAutoFocus?.(event)
      if (event.defaultPrevented) return

      const back = returnFocusRef.current

      // A write fired on the way out puts an Undo in the toast stack, and the
      // stack takes focus itself so the Undo is reachable inside the seconds it
      // lives. Radix's restore runs a tick later, so it would take that Undo
      // away a frame after offering it — hand the trigger to the toast instead,
      // to be used when it goes.
      if (document.activeElement?.closest(TOAST_STACK_SELECTOR)) {
        deferFocusReturn(back?.isConnected ? back : null)
        event.preventDefault()
        return
      }

      // Gone with the record it belonged to — a row's own delete button, say.
      // Leave it to Radix rather than inventing a landing place.
      if (!back?.isConnected) return
      event.preventDefault()
      back.focus({ preventScroll: true })
    },
    [onCloseAutoFocus],
  )

  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        ref={setRef}
        onCloseAutoFocus={handleCloseAutoFocus}
        className={cn(
          // `grid-cols-[minmax(0,1fr)]` is load-bearing: a grid column defaults
          // to `auto`, which sizes to the widest child's *content* rather than
          // to the frame. Without it the create form computes a 446px column
          // inside a 358px dialog at 390px wide and pushes its own footer
          // buttons off the screen.
          'fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 grid-cols-[minmax(0,1fr)] gap-4 rounded-xl bg-popover p-4 text-sm text-popover-foreground ring-1 ring-foreground/10 outline-none sm:max-w-md',
          !reducedMotion &&
            'duration-[260ms] ease-[cubic-bezier(0.32,0.72,0,1)] data-open:animate-in data-open:fade-in-0 data-open:zoom-in-92 data-closed:animate-out data-closed:duration-150 data-closed:fade-out-0 data-closed:zoom-out-95',
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close data-slot="dialog-close" asChild>
            <Button variant="ghost" className="absolute top-2 right-2" size="icon-sm">
              <XIcon />
              <span className="sr-only">Close</span>
            </Button>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    // The corner close button floats over this row, so the header keeps a
    // gutter for it rather than letting a long title run underneath.
    <div
      data-slot="dialog-header"
      className={cn('flex flex-col gap-2 pr-7', className)}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<'div'> & {
  showCloseButton?: boolean
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        '-mx-4 -mb-4 flex flex-col-reverse gap-2 rounded-b-xl border-t bg-muted/50 p-4 sm:flex-row sm:justify-end',
        className,
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close asChild>
          <Button variant="outline">Close</Button>
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn('text-base leading-none font-medium', className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        'text-sm text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground',
        className,
      )}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
