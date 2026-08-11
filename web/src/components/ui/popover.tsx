import * as React from 'react'
import { Popover as PopoverPrimitive } from 'radix-ui'

import { cn } from '@/lib/utils'

/**
 * The id of the element that actually opened this popover.
 *
 * Radix stamps `role="dialog"` on the content and supplies no accessible name,
 * so every popover in the app announced as an unnamed dialog: the AX tree read
 * `role = dialog | name = ""` at all nineteen call sites, none of which passed
 * an `aria-label`. This file used to export `PopoverHeader`, `PopoverTitle` and
 * `PopoverDescription` — three components whose whole purpose was that name —
 * and no file in `src` imported any of them, so the gap and the machinery for
 * closing it sat side by side. They are gone; the name is derived here instead.
 *
 * Naming the panel after its trigger, rather than asking each call site to
 * remember an `aria-label`, is the point: nineteen call sites forgot once
 * already, and the twentieth would forget too. `aria-labelledby` pointing at a
 * button whose own name comes from `aria-label` resolves correctly — the name
 * computation reads the referenced element's `aria-label` — which is what makes
 * "Edit the keyword Research" and "Applications options" land on the dialog.
 */
const PopoverLabelContext = React.createContext<{
  labelId: string | null
  setLabelId: (id: string | null) => void
} | null>(null)

/**
 * Which naming attribute the content should carry, given the trigger's id.
 *
 * Split out as a plain function because it is the whole of the decision and
 * nothing here renders in a test: a call site that states its own name must
 * win, or wiring this up would have quietly overwritten the one or two panels
 * somebody had already named by hand.
 */
export function popoverLabelling(
  triggerId: string | null,
  stated: { ariaLabel?: string | undefined; ariaLabelledBy?: string | undefined },
): { 'aria-label'?: string; 'aria-labelledby'?: string } {
  if (stated.ariaLabel !== undefined) return { 'aria-label': stated.ariaLabel }
  if (stated.ariaLabelledBy !== undefined) return { 'aria-labelledby': stated.ariaLabelledBy }
  return triggerId === null ? {} : { 'aria-labelledby': triggerId }
}

function Popover({ ...props }: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  const [labelId, setLabelId] = React.useState<string | null>(null)
  const value = React.useMemo(() => ({ labelId, setLabelId }), [labelId])

  return (
    <PopoverLabelContext value={value}>
      <PopoverPrimitive.Root data-slot="popover" {...props} />
    </PopoverLabelContext>
  )
}

function PopoverTrigger({
  ref,
  id,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
  const label = React.useContext(PopoverLabelContext)
  const setLabelId = label?.setLabelId
  const fallbackId = React.useId()
  const node = React.useRef<HTMLButtonElement | null>(null)

  const attach = React.useCallback(
    (el: HTMLButtonElement | null) => {
      node.current = el
      if (typeof ref === 'function') ref(el)
      else if (ref) ref.current = el
    },
    [ref],
  )

  React.useEffect(() => {
    if (!setLabelId) return
    // Read the id off the element that actually rendered rather than trusting
    // the one passed down. Three call sites use `asChild` over a child that
    // carries its own id because a <label htmlFor> points at it, and Radix's
    // Slot lets the child's id win the merge — assuming ours survived would
    // have aimed `aria-labelledby` at an element that does not exist, which
    // computes to the same empty name this was written to fix.
    setLabelId(node.current?.id || null)
    return () => setLabelId(null)
  }, [setLabelId, id, fallbackId])

  return (
    <PopoverPrimitive.Trigger
      data-slot="popover-trigger"
      ref={attach}
      id={id ?? fallbackId}
      {...props}
    />
  )
}

function PopoverContent({
  className,
  align = 'center',
  sideOffset = 4,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  const label = React.useContext(PopoverLabelContext)

  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        align={align}
        sideOffset={sideOffset}
        {...popoverLabelling(label?.labelId ?? null, { ariaLabel, ariaLabelledBy })}
        className={cn(
          'z-50 flex w-72 origin-(--radix-popover-content-transform-origin) flex-col gap-2.5 rounded-lg bg-popover p-2.5 text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-hidden duration-100 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95',
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  )
}

function PopoverAnchor({ ...props }: React.ComponentProps<typeof PopoverPrimitive.Anchor>) {
  return <PopoverPrimitive.Anchor data-slot="popover-anchor" {...props} />
}

export { Popover, PopoverAnchor, PopoverContent, PopoverTrigger }
