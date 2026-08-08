import { cn } from '@/lib/utils'
import type { ComponentProps, ReactNode } from 'react'

/** The app's primary frosted surface. */
export function Panel({ className, ...props }: ComponentProps<'section'>) {
  return (
    <section className={cn('surface rounded-lg px-4 py-4 sm:px-5 sm:py-5', className)} {...props} />
  )
}

/**
 * A scroll region that reaches its container's edges.
 *
 * A scroller nested inside a padded surface inherits that padding as a gutter,
 * so its scrollbar floats in from the border and reads as belonging to nothing.
 * Cancelling the padding with a negative margin and re-applying it as padding
 * *inside* the scroller puts the bar on the edge while leaving the content
 * exactly where it was — and the re-applied padding scrolls with the content,
 * so nothing butts against the border on the way past.
 *
 * The bottom is cancelled too, so a horizontal bar lands on the bottom edge
 * rather than hovering above it. That assumes this is the last child of its
 * container, which is what a scroll region filling the remaining space is.
 *
 * `min-h-0` is part of the contract: without it `flex-1` means "at least my
 * content" and the region grows its container instead of scrolling inside it.
 */
export function PanelScroll({
  className,
  axis = 'both',
  inset = 'panel',
  ...props
}: ComponentProps<'div'> & {
  axis?: 'x' | 'y' | 'both'
  /** Which padding to escape: a Panel's, or a tighter `p-2` surface. */
  inset?: 'panel' | 'tight'
}) {
  return (
    <div
      className={cn(
        'min-h-0 flex-1',
        inset === 'tight'
          ? '-mx-2 -mb-2 px-2 pb-2'
          : '-mx-4 -mb-4 px-4 pb-4 sm:-mx-5 sm:-mb-5 sm:px-5 sm:pb-5',
        axis === 'x' ? 'overflow-x-auto' : axis === 'y' ? 'overflow-y-auto' : 'overflow-auto',
        className,
      )}
      {...props}
    />
  )
}

export function PanelTitle({
  children,
  hint,
  className,
  ...props
}: ComponentProps<'h2'> & { hint?: ReactNode }) {
  return (
    <h2 className={cn('mb-3.5 text-base font-medium', className)} {...props}>
      {children}
      {hint ? (
        <small className="ml-2 font-sans text-xs font-normal text-text-3">{hint}</small>
      ) : null}
    </h2>
  )
}

/**
 * Groups rows and draws dividers *between* them.
 *
 * Rows previously carried their own `border-t` plus `first:border-t-0` to drop
 * the leading one — but `first:` is `:first-child`, and PanelTitle's <h2> holds
 * that position, so no row ever matched and every panel drew a stray line under
 * its heading. Owning the dividers here is correct regardless of what else the
 * panel contains.
 */
export function RowList({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('divide-y divide-hairline', className)} {...props} />
}

/** A single list row. Wrap a group of them in <RowList>. */
export function Row({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('flex items-center gap-3 px-1 py-2.5 text-sm', className)} {...props} />
}
